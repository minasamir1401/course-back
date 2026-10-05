export async function examActivitySeries(db: any, now = new Date()) {
  return Promise.all(Array.from({length:7}, (_,i) => {
    const start = new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate() - 6 + i)), end = new Date(start.getTime() + 86400000);
    return Promise.all([
      db.exam.count({where:{deletedAt:null,createdAt:{gte:start,lt:end}}}),
      db.examSubmission.count({where:{createdAt:{gte:start,lt:end}}})
    ]).then(([exams,submissions]) => ({date:start.toISOString(),exams,submissions}));
  }));
}
export async function schoolPerformanceSeries(db: any, schoolId: string, now = new Date()) {
  return Promise.all(Array.from({length:6}, (_,i) => {
    const start = new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth() - 5 + i,1)), end = new Date(Date.UTC(start.getUTCFullYear(),start.getUTCMonth()+1,1));
    return db.examSubmission.aggregate({where:{user:{schoolId,deletedAt:null},createdAt:{gte:start,lt:end}},_avg:{percentage:true},_count:{id:true}})
      .then((result: any) => ({date:start.toISOString(),score:result._avg.percentage == null ? null : Math.round(result._avg.percentage),attempts:result._count.id}));
  }));
}
