import type { Incident } from './types.ts';

/**
 * Where incidents live. The in-memory store is the default; a durable store
 * (for example DynamoDB) only has to implement these three methods.
 */
export interface IncidentStore {
  get(fingerprint: string): Incident | undefined;
  put(incident: Incident): void;
  list(): Incident[];
}

export class MemoryStore implements IncidentStore {
  private readonly incidents = new Map<string, Incident>();

  get(fingerprint: string): Incident | undefined {
    const found = this.incidents.get(fingerprint);
    return found ? { ...found } : undefined;
  }

  put(incident: Incident): void {
    this.incidents.set(incident.fingerprint, { ...incident });
  }

  list(): Incident[] {
    return [...this.incidents.values()].map((incident) => ({ ...incident }));
  }
}
