import type { INestApplication } from '@nestjs/common';
import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os';

/**
 * Sentinel value for `TRUSTED_PROXY_CIDRS` that asks Coda to derive the trust
 * set from the container's own network interfaces at boot instead of relying on
 * an operator-supplied CIDR list.
 */
export const AUTO_TRUSTED_PROXIES = 'auto';

/**
 * Trust set for the desktop profile: loopback only. A local single-user app sits behind no reverse
 * proxy, so X-Forwarded-For from anything but the local host must never be honored.
 */
export const LOOPBACK_TRUSTED_PROXY_CIDRS: readonly string[] = ['127.0.0.1/32', '::1/128'];

interface ExpressSettings {
  set(name: string, value: unknown): void;
}

export function configureTrustedProxies(
  app: Pick<INestApplication, 'getHttpAdapter'>,
  trustedProxyCidrs: string[],
): void {
  const instance = app.getHttpAdapter().getInstance() as ExpressSettings;
  instance.set('trust proxy', trustedProxyCidrs);
}

/**
 * Turn the validated `TRUSTED_PROXY_CIDRS` value into the concrete CIDR list
 * Express trusts. An explicit list is returned verbatim; `auto` is expanded to
 * the subnets attached to the container's non-loopback interfaces.
 */
export function resolveTrustedProxyCidrs(
  configured: typeof AUTO_TRUSTED_PROXIES | string[],
  interfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces(),
): string[] {
  return configured === AUTO_TRUSTED_PROXIES ? detectLocalSubnets(interfaces) : configured;
}

/**
 * Derive the local subnets from every non-loopback interface. Each interface
 * address is masked down to its network address so the whole attached subnet is
 * trusted, which is what lets the platform's reverse proxy reach Coda from a
 * peer address inside the same private network.
 */
export function detectLocalSubnets(
  interfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces(),
): string[] {
  const subnets = new Set<string>();
  for (const infos of Object.values(interfaces)) {
    for (const info of infos ?? []) {
      if (info.internal) continue;
      const subnet = interfaceSubnet(info);
      if (subnet) subnets.add(subnet);
    }
  }
  return [...subnets];
}

function interfaceSubnet(info: NetworkInterfaceInfo): string | undefined {
  const v4 = info.family === 'IPv4';
  const prefix = interfacePrefix(info, v4);
  if (prefix === undefined) return undefined;
  const network = v4
    ? ipv4Network(info.address, prefix)
    : ipv6Network(stripZone(info.address), prefix);
  return network === undefined ? undefined : `${network}/${prefix}`;
}

function interfacePrefix(info: NetworkInterfaceInfo, v4: boolean): number | undefined {
  const max = v4 ? 32 : 128;
  const raw = info.cidr?.split('/')[1];
  if (raw !== undefined && /^\d+$/u.test(raw)) {
    const bits = Number(raw);
    if (bits >= 0 && bits <= max) return bits;
  }
  return v4
    ? netmaskPrefix(info.netmask, ipv4ToBigInt, 32)
    : netmaskPrefix(stripZone(info.netmask), ipv6ToBigInt, 128);
}

function netmaskPrefix(
  netmask: string,
  toBigInt: (value: string) => bigint | undefined,
  width: number,
): number | undefined {
  if (!netmask) return undefined;
  const mask = toBigInt(netmask);
  if (mask === undefined) return undefined;
  let prefix = 0;
  let seenZero = false;
  for (let index = width - 1; index >= 0; index--) {
    if (((mask >> BigInt(index)) & 1n) === 1n) {
      if (seenZero) return undefined; // reject non-contiguous masks
      prefix++;
    } else {
      seenZero = true;
    }
  }
  return prefix;
}

function ipv4Network(address: string, prefix: number): string | undefined {
  const int = ipv4ToBigInt(address);
  if (int === undefined) return undefined;
  const network = applyPrefix(int, prefix, 32);
  return [24n, 16n, 8n, 0n].map((shift) => ((network >> shift) & 0xffn).toString()).join('.');
}

function ipv6Network(address: string, prefix: number): string | undefined {
  const int = ipv6ToBigInt(address);
  if (int === undefined) return undefined;
  return compressIpv6(bigIntToHextets(applyPrefix(int, prefix, 128)));
}

function applyPrefix(value: bigint, prefix: number, width: number): bigint {
  if (prefix >= width) return value;
  const hostBits = BigInt(width - prefix);
  const mask = ((1n << BigInt(width)) - 1n) ^ ((1n << hostBits) - 1n);
  return value & mask;
}

function ipv4ToBigInt(value: string): bigint | undefined {
  const parts = value.split('.');
  if (parts.length !== 4) return undefined;
  let result = 0n;
  for (const part of parts) {
    if (!/^\d{1,3}$/u.test(part)) return undefined;
    const octet = Number(part);
    if (octet > 255) return undefined;
    result = (result << 8n) | BigInt(octet);
  }
  return result;
}

function ipv6ToBigInt(value: string): bigint | undefined {
  const halves = value.split('::');
  if (halves.length > 2) return undefined;
  const head = parseHextets(halves[0] ?? '');
  if (!head) return undefined;
  if (halves.length === 1) {
    return head.length === 8 ? hextetsToBigInt(head) : undefined;
  }
  const tail = parseHextets(halves[1] ?? '');
  if (!tail) return undefined;
  const missing = 8 - head.length - tail.length;
  if (missing < 1) return undefined; // "::" must stand for at least one zero group
  return hextetsToBigInt([...head, ...Array<bigint>(missing).fill(0n), ...tail]);
}

function parseHextets(part: string): bigint[] | undefined {
  if (part === '') return [];
  const groups: bigint[] = [];
  for (const hextet of part.split(':')) {
    if (!/^[0-9a-fA-F]{1,4}$/u.test(hextet)) return undefined;
    groups.push(BigInt(parseInt(hextet, 16)));
  }
  return groups;
}

function hextetsToBigInt(groups: bigint[]): bigint {
  let result = 0n;
  for (const group of groups) result = (result << 16n) | group;
  return result;
}

function bigIntToHextets(value: bigint): string[] {
  const hextets: string[] = [];
  for (let index = 7; index >= 0; index--) {
    hextets.push(((value >> BigInt(index * 16)) & 0xffffn).toString(16));
  }
  return hextets;
}

function compressIpv6(hextets: string[]): string {
  let bestStart = -1;
  let bestLength = 0;
  let start = -1;
  let length = 0;
  hextets.forEach((hextet, index) => {
    if (hextet !== '0') {
      start = -1;
      length = 0;
      return;
    }
    start = start === -1 ? index : start;
    length++;
    if (length > bestLength) {
      bestLength = length;
      bestStart = start;
    }
  });
  if (bestLength < 2) return hextets.join(':');
  const head = hextets.slice(0, bestStart).join(':');
  const tail = hextets.slice(bestStart + bestLength).join(':');
  return `${head}::${tail}`;
}

function stripZone(value: string | undefined): string {
  return value?.split('%')[0] ?? '';
}
