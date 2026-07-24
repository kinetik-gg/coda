// Advisory-lock namespace for scheduler jobs. Postgres advisory locks come in two shapes: a single
// bigint key, and a pair of int4 keys that occupies an independent lock space. Auth's setup and
// password-reset guards use the single-bigint form (pg_advisory_xact_lock(<bigint>)); the scheduler
// uses the two-int form (pg_try_advisory_xact_lock(<namespace>, hashtext(key))) so a job key can
// never collide with those unrelated locks. The namespace is the ASCII bytes for "SCHD".
export const SCHEDULER_LOCK_NAMESPACE = 0x53_43_48_44;
