// Error classes shared by schedules.ts and workflow-schema.ts. Kept in their
// own module so workflow-schema.ts can throw ScheduleValidationError without
// importing schedules.ts (which imports workflow-schema.ts — would be a cycle).

export class ScheduleValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScheduleValidationError";
  }
}

export class ScheduleNotFoundError extends Error {
  constructor(id: string) {
    super(`Schedule ${id} not found`);
    this.name = "ScheduleNotFoundError";
  }
}
