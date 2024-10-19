export function createNamedLogger(name: string) {
    return (type: "log" | "error" | "debug" |  "warn" | "info", ...args: Array<unknown>): void => console[type](`${name}:`, ...args);
}