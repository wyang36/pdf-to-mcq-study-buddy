// `server-only` throws unless it is resolved under React's "react-server"
// condition, which Vitest does not set. The guard is enforced by `next build`
// (verified there); in unit tests we alias it to this no-op so the modules that
// import it can be exercised directly.
export {};
