import { equipmentProfiles } from '../schema/index.js';
import { createCrudRepository, type CrudRepository, type DrizzleDb } from './shared.js';

export type EquipmentProfilesRepository = CrudRepository<typeof equipmentProfiles>;

export function createEquipmentProfilesRepository(db: DrizzleDb): EquipmentProfilesRepository {
  return createCrudRepository(db, equipmentProfiles);
}
