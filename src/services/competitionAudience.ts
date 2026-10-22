import { CONTENT_KINDS } from './contentCompetitions';

function reject(code: string, http = 400): never { throw Object.assign(new Error(code), { http }); }

/** Call under the competition advisory lock, shared with the student join flow. */
export async function resolveCompetitionAudience(db: any, user: any, room: any, input: any) {
  if (!input || !['schoolId', 'grade'].some(key => Object.prototype.hasOwnProperty.call(input, key))) reject('AUDIENCE_DETAILS');
  for (const key of ['schoolId', 'grade']) {
    const value = input[key];
    if (value !== undefined && value !== null && (typeof value !== 'string' || value.length > 100)) reject('AUDIENCE_DETAILS');
  }
  if (!['DRAFT', 'OPEN'].includes(room.status) || (room.mode === 'LIVE' && room.currentIndex >= 0) || CONTENT_KINDS.includes(room.sourceKind)) reject('AUDIENCE_LOCKED', 409);
  const schoolId = input.schoolId === undefined ? room.schoolId : input.schoolId?.trim() || null;
  const grade = input.grade === undefined ? room.grade : input.grade?.trim() || null;
  if (user.role !== 'SUPER_ADMIN' && (!user.schoolId || schoolId !== user.schoolId)) reject('SCHOOL_ACCESS', 403);
  if (schoolId === room.schoolId && grade === room.grade) return { schoolId, grade };
  if (await db.competitionEntry.count({ where: { competitionId: room.id } })) reject('AUDIENCE_HAS_PARTICIPANTS', 409);
  if (schoolId && !await db.school.findFirst({ where: { id: schoolId, status: 'ACTIVE' }, select: { id: true } })) reject('SCHOOL_NOT_FOUND', 404);
  return { schoolId, grade };
}
