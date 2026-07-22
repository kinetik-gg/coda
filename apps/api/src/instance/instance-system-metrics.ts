import { statfsSync } from 'node:fs';
import {
  arch,
  availableParallelism,
  cpus,
  freemem,
  loadavg,
  platform,
  release,
  totalmem,
  uptime as systemUptime,
} from 'node:os';
import { performance } from 'node:perf_hooks';

interface CpuTimes {
  idle: number;
  total: number;
}

interface MetricSample {
  sampledAt: Date;
  cpuPercent: number;
  memoryPercent: number;
  processRssBytes: number;
  processHeapUsedBytes: number;
}

const METRIC_HISTORY_LIMIT = 120;

export class InstanceSystemMetrics {
  private previousCpuTimes?: CpuTimes;
  private previousEventLoopUtilization = performance.eventLoopUtilization();
  private readonly metricHistory: MetricSample[] = [];

  status() {
    const sampledAt = new Date();
    const memoryTotalBytes = totalmem();
    const memoryFreeBytes = freemem();
    const memoryUsedBytes = memoryTotalBytes - memoryFreeBytes;
    const memoryPercent = percentage(memoryUsedBytes, memoryTotalBytes);
    const cpuPercent = this.cpuUsagePercent();
    const currentEventLoop = performance.eventLoopUtilization(this.previousEventLoopUtilization);
    this.previousEventLoopUtilization = performance.eventLoopUtilization();
    const memory = process.memoryUsage();
    const sample: MetricSample = {
      sampledAt,
      cpuPercent,
      memoryPercent,
      processRssBytes: memory.rss,
      processHeapUsedBytes: memory.heapUsed,
    };
    this.metricHistory.push(sample);
    if (this.metricHistory.length > METRIC_HISTORY_LIMIT) this.metricHistory.shift();

    return {
      sampledAt,
      runtime: {
        state: 'running' as const,
        nodeVersion: process.version,
        processUptimeSeconds: Math.round(process.uptime()),
        eventLoopUtilizationPercent: Math.round(currentEventLoop.utilization * 1_000) / 10,
        memory: {
          rssBytes: memory.rss,
          heapUsedBytes: memory.heapUsed,
          heapTotalBytes: memory.heapTotal,
          externalBytes: memory.external,
        },
      },
      operatingSystem: {
        platform: platform(),
        release: release(),
        architecture: arch(),
        uptimeSeconds: Math.round(systemUptime()),
      },
      cpu: {
        usagePercent: cpuPercent,
        logicalCores: availableParallelism(),
        model: cpus()[0]?.model.trim() || 'Unknown processor',
        loadAverage: {
          oneMinute: loadavg()[0] ?? 0,
          fiveMinutes: loadavg()[1] ?? 0,
          fifteenMinutes: loadavg()[2] ?? 0,
        },
      },
      memory: {
        totalBytes: memoryTotalBytes,
        usedBytes: memoryUsedBytes,
        freeBytes: memoryFreeBytes,
        usagePercent: memoryPercent,
      },
      disk: diskStatus(),
      history: [...this.metricHistory],
    };
  }

  private cpuUsagePercent(): number {
    const current = cpus().reduce<CpuTimes>(
      (sum, cpu) => {
        const total = Object.values(cpu.times).reduce((time, value) => time + value, 0);
        return { idle: sum.idle + cpu.times.idle, total: sum.total + total };
      },
      { idle: 0, total: 0 },
    );
    const previous = this.previousCpuTimes;
    this.previousCpuTimes = current;
    const idle = current.idle - (previous?.idle ?? 0);
    const total = current.total - (previous?.total ?? 0);
    return Math.round((100 - percentage(idle, total)) * 10) / 10;
  }
}

function diskStatus() {
  try {
    const stats = statfsSync(process.cwd(), { bigint: true });
    const totalBytes = stats.bsize * stats.blocks;
    const freeBytes = stats.bsize * stats.bavail;
    const usedBytes = totalBytes - freeBytes;
    return {
      available: true as const,
      totalBytes,
      usedBytes,
      freeBytes,
      usagePercent: percentage(Number(usedBytes), Number(totalBytes)),
    };
  } catch {
    return { available: false as const };
  }
}

function percentage(value: number, total: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.round((value / total) * 1_000) / 10;
}
