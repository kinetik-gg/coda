import type { NetworkInterfaceInfo } from 'node:os';
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import {
  AUTO_TRUSTED_PROXIES,
  configureTrustedProxies,
  detectLocalSubnets,
  resolveTrustedProxyCidrs,
} from './trusted-proxies';

const loopback4: NetworkInterfaceInfo = {
  address: '127.0.0.1',
  netmask: '255.0.0.0',
  family: 'IPv4',
  mac: '00:00:00:00:00:00',
  internal: true,
  cidr: '127.0.0.1/8',
};

const loopback6: NetworkInterfaceInfo = {
  address: '::1',
  netmask: 'ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff',
  family: 'IPv6',
  mac: '00:00:00:00:00:00',
  internal: true,
  cidr: '::1/128',
  scopeid: 0,
};

const bridge4: NetworkInterfaceInfo = {
  address: '172.18.0.5',
  netmask: '255.255.0.0',
  family: 'IPv4',
  mac: '02:42:ac:12:00:05',
  internal: false,
  cidr: '172.18.0.5/16',
};

const global6: NetworkInterfaceInfo = {
  address: 'fd00:abcd:1234:5678::a1b2',
  netmask: 'ffff:ffff:ffff:ffff::',
  family: 'IPv6',
  mac: '02:42:ac:12:00:05',
  internal: false,
  cidr: 'fd00:abcd:1234:5678::a1b2/64',
  scopeid: 0,
};

const linkLocal6: NetworkInterfaceInfo = {
  address: 'fe80::42:acff:fe12:5%eth0',
  netmask: 'ffff:ffff:ffff:ffff::',
  family: 'IPv6',
  mac: '02:42:ac:12:00:05',
  internal: false,
  cidr: 'fe80::42:acff:fe12:5/64',
  scopeid: 2,
};

function nestApplication(expressApplication: ReturnType<typeof express>) {
  return {
    getHttpAdapter: () => ({ getInstance: () => expressApplication }),
  };
}

describe('trusted proxy configuration', () => {
  it('uses the nearest untrusted forwarded address as the client IP', async () => {
    const application = express();
    configureTrustedProxies(nestApplication(application) as never, ['127.0.0.1/32', '::1/128']);
    application.get('/', (request_, response) =>
      response.json({ ip: request_.ip, ips: request_.ips }),
    );

    const response = await request(application)
      .get('/')
      .set('x-forwarded-for', '203.0.113.9, 198.51.100.42')
      .expect(200);

    expect(response.body).toMatchObject({ ip: '198.51.100.42', ips: ['198.51.100.42'] });
  });

  it('ignores forwarded addresses from an untrusted direct peer', async () => {
    const application = express();
    configureTrustedProxies(nestApplication(application) as never, ['10.20.30.0/24']);
    application.get('/', (request_, response) => response.json({ ip: request_.ip }));

    const response = await request(application)
      .get('/')
      .set('x-forwarded-for', '198.51.100.42')
      .expect(200);

    const body = JSON.parse(response.text) as { ip?: string };
    expect(body.ip).not.toBe('198.51.100.42');
  });
});

describe('local subnet detection', () => {
  it('masks non-loopback interface addresses down to their network CIDR', () => {
    expect(detectLocalSubnets({ eth0: [bridge4], eth1: [global6] })).toEqual([
      '172.18.0.0/16',
      'fd00:abcd:1234:5678::/64',
    ]);
  });

  it('excludes loopback interfaces from the trust set', () => {
    expect(detectLocalSubnets({ lo: [loopback4, loopback6], eth0: [bridge4] })).toEqual([
      '172.18.0.0/16',
    ]);
  });

  it('compresses zero runs and strips the zone id for IPv6 subnets', () => {
    expect(detectLocalSubnets({ eth0: [linkLocal6] })).toEqual(['fe80::/64']);
  });

  it('deduplicates subnets shared across interfaces', () => {
    expect(detectLocalSubnets({ eth0: [bridge4], eth1: [bridge4] })).toEqual(['172.18.0.0/16']);
  });

  it('falls back to the netmask when no cidr string is present', () => {
    const withoutCidr: NetworkInterfaceInfo = { ...bridge4, cidr: null };
    expect(detectLocalSubnets({ eth0: [withoutCidr] })).toEqual(['172.18.0.0/16']);
  });

  it('skips interfaces with no derivable prefix or malformed address', () => {
    const noPrefix: NetworkInterfaceInfo = { ...bridge4, cidr: null, netmask: '' };
    const malformed: NetworkInterfaceInfo = { ...bridge4, cidr: '999.1.1.1/16', address: 'nope' };
    expect(detectLocalSubnets({ eth0: [noPrefix], eth1: [malformed] })).toEqual([]);
  });

  it('returns an empty set when only loopback interfaces exist', () => {
    expect(detectLocalSubnets({ lo: [loopback4] })).toEqual([]);
  });
});

describe('trusted proxy resolution', () => {
  it('passes an explicit CIDR list through unchanged', () => {
    expect(resolveTrustedProxyCidrs(['10.20.30.0/24', '::1/128'])).toEqual([
      '10.20.30.0/24',
      '::1/128',
    ]);
  });

  it('expands the auto sentinel into detected subnets', () => {
    expect(resolveTrustedProxyCidrs(AUTO_TRUSTED_PROXIES, { eth0: [bridge4] })).toEqual([
      '172.18.0.0/16',
    ]);
  });
});
