import { PulseIcon } from '@phosphor-icons/react/dist/csr/Pulse';
import styles from '../AdminScreen.styles';
import { EmptyState } from './AdminCommon';
import { ProjectRows } from './AdminRows';
import type { AdminPage, InstanceManagementSummary } from './types';
import { bytes, duration } from './utils';

function Sparkline({ values, label }: { values: number[]; label: string }) {
  if (values.length < 2) return <div className={styles.graphEmpty}>Collecting samples…</div>;
  const points = values
    .map(
      (value, index) =>
        `${(index / (values.length - 1)) * 100},${32 - Math.max(0, Math.min(100, value)) * 0.32}`,
    )
    .join(' ');
  return (
    <svg
      className={styles.sparkline}
      viewBox="0 0 100 32"
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
    >
      <path d="M0 8H100M0 16H100M0 24H100" className={styles.graphGrid} />
      <polyline points={points} className={styles.graphLine} />
    </svg>
  );
}

export function OverviewPage({
  management,
  system,
  readiness,
  onPageChange,
}: {
  management: InstanceManagementSummary;
  system: InstanceManagementSummary['system'] | undefined;
  readiness: { isError: boolean; isFetching: boolean };
  onPageChange: (page: AdminPage) => void;
}) {
  const cpuHistory = system?.history.map((sample) => sample.cpuPercent) ?? [];
  const memoryHistory = system?.history.map((sample) => sample.memoryPercent) ?? [];

  return (
    <div className={styles.sectionStack}>
      <section className={styles.metricGrid} aria-label="Instance totals">
        <article className={styles.metricCard}>
          <span>Service</span>
          <strong className={readiness.isError ? styles.unhealthy : styles.healthy}>
            {readiness.isFetching ? 'Checking…' : readiness.isError ? 'Unavailable' : 'Ready'}
          </strong>
          <small>Polled every 10 seconds</small>
        </article>
        <article className={styles.metricCard}>
          <span>Breakdowns</span>
          <strong>{management.counts.activeProjects}</strong>
          <small>{management.counts.trashedProjects} retained in trash</small>
        </article>
        <article className={styles.metricCard}>
          <span>Users</span>
          <strong>{management.counts.users}</strong>
          <small>{management.counts.activeSessions} active sessions</small>
        </article>
        <article className={styles.metricCard}>
          <span>Storage</span>
          <strong>{bytes(management.counts.storageBytes)}</strong>
          <small>{management.counts.storageObjects} active objects</small>
        </article>
      </section>
      {system ? (
        <SystemMetrics system={system} cpuHistory={cpuHistory} memoryHistory={memoryHistory} />
      ) : (
        <EmptyState icon={<PulseIcon size={22} />} title="System metrics are unavailable.">
          The API did not return a host telemetry sample.
        </EmptyState>
      )}
      <section className={styles.panel}>
        <div className={styles.panelHeading}>
          <div>
            <h2>Recent breakdowns</h2>
            <p>Most recently updated across the instance.</p>
          </div>
          <button
            type="button"
            className={styles.textButton}
            onClick={() => onPageChange('projects')}
          >
            View all
          </button>
        </div>
        <ProjectRows items={management.projects.slice(0, 8)} />
      </section>
    </div>
  );
}

function SystemMetrics({
  system,
  cpuHistory,
  memoryHistory,
}: {
  system: InstanceManagementSummary['system'];
  cpuHistory: number[];
  memoryHistory: number[];
}) {
  return (
    <>
      <section className={styles.graphGrid}>
        <article className={styles.graphCard}>
          <header>
            <div>
              <span>CPU usage</span>
              <strong>{system.cpu.usagePercent.toFixed(1)}%</strong>
            </div>
            <small>{system.cpu.logicalCores} logical cores</small>
          </header>
          <Sparkline values={cpuHistory} label="CPU usage history" />
          <footer>{system.cpu.model}</footer>
        </article>
        <article className={styles.graphCard}>
          <header>
            <div>
              <span>Memory usage</span>
              <strong>{system.memory.usagePercent.toFixed(1)}%</strong>
            </div>
            <small>
              {bytes(system.memory.usedBytes)} / {bytes(system.memory.totalBytes)}
            </small>
          </header>
          <Sparkline values={memoryHistory} label="Memory usage history" />
          <footer>{bytes(system.memory.freeBytes)} available</footer>
        </article>
      </section>
      <section className={styles.detailGrid} aria-label="System details">
        <article className={styles.detailCard}>
          <h2>Host</h2>
          <dl>
            <div>
              <dt>Operating system</dt>
              <dd>
                {system.operatingSystem.platform} {system.operatingSystem.release}
              </dd>
            </div>
            <div>
              <dt>Architecture</dt>
              <dd>{system.operatingSystem.architecture}</dd>
            </div>
            <div>
              <dt>Host uptime</dt>
              <dd>{duration(system.operatingSystem.uptimeSeconds)}</dd>
            </div>
            <div>
              <dt>Load average</dt>
              <dd>
                {system.cpu.loadAverage.oneMinute.toFixed(2)} /{' '}
                {system.cpu.loadAverage.fiveMinutes.toFixed(2)} /{' '}
                {system.cpu.loadAverage.fifteenMinutes.toFixed(2)}
              </dd>
            </div>
          </dl>
        </article>
        <article className={styles.detailCard}>
          <h2>API process</h2>
          <dl>
            <div>
              <dt>Runtime</dt>
              <dd>{system.runtime.nodeVersion}</dd>
            </div>
            <div>
              <dt>Process uptime</dt>
              <dd>{duration(system.runtime.processUptimeSeconds)}</dd>
            </div>
            <div>
              <dt>Resident memory</dt>
              <dd>{bytes(system.runtime.memory.rssBytes)}</dd>
            </div>
            <div>
              <dt>Heap</dt>
              <dd>
                {bytes(system.runtime.memory.heapUsedBytes)} /{' '}
                {bytes(system.runtime.memory.heapTotalBytes)}
              </dd>
            </div>
            <div>
              <dt>Event loop use</dt>
              <dd>{system.runtime.eventLoopUtilizationPercent.toFixed(1)}%</dd>
            </div>
          </dl>
        </article>
        <article className={styles.detailCard}>
          <h2>Disk</h2>
          {system.disk.available ? (
            <dl>
              <div>
                <dt>Used</dt>
                <dd>{bytes(system.disk.usedBytes)}</dd>
              </div>
              <div>
                <dt>Available</dt>
                <dd>{bytes(system.disk.freeBytes)}</dd>
              </div>
              <div>
                <dt>Total</dt>
                <dd>{bytes(system.disk.totalBytes)}</dd>
              </div>
              <div>
                <dt>Utilization</dt>
                <dd>{system.disk.usagePercent.toFixed(1)}%</dd>
              </div>
            </dl>
          ) : (
            <p className={styles.unavailable}>Disk metrics are not available from this runtime.</p>
          )}
        </article>
      </section>
    </>
  );
}
