import { filters } from '../schema/index.js';
import { createCrudRepository, type CrudRepository, type DrizzleDb } from './shared.js';

export type FiltersRepository = CrudRepository<typeof filters>;

export function createFiltersRepository(db: DrizzleDb): FiltersRepository {
  return createCrudRepository(db, filters);
}
