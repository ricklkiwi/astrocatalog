import { sessions } from '../schema/index.js';
import { createCrudRepository, type CrudRepository, type DrizzleDb } from './shared.js';

export type SessionsRepository = CrudRepository<typeof sessions>;

export function createSessionsRepository(db: DrizzleDb): SessionsRepository {
  return createCrudRepository(db, sessions);
}
