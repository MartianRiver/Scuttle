let n = 0;
export const nextId = (prefix: string) => `${prefix}-${++n}`;
