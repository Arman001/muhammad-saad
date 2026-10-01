/** Source of the current time. Injected so domain logic can be tested at any moment in time. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};
