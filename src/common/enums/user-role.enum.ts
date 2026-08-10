/**
 * Matches schema/enums.schema.ts's `roleEnum` and the Asgardeo `role` JWT claim
 * exactly. Renamed from the old `MembershipRole` (community_user/volunteer/org_admin)
 * — there is no more `organisation_members` join table to name it after; role now
 * lives directly on `users`.
 */
export enum UserRole {
  CITIZEN = 'citizen',
  VOLUNTEER = 'volunteer',
  ORG_ADMIN = 'org_admin',
}
