// React 19 requires this flag for act() to batch and flush updates; Testing Library's render,
// findBy*, and waitFor all rely on it. Without it, query-driven effects flush outside act's
// scope and assertions race the commit (seen as intermittent localStorage persistence misses).
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
