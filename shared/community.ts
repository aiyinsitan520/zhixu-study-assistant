export type LeaderboardEntry={userId:string;name:string;role:'admin'|'student';anonymous:boolean;attempts:number;correct:number;accuracy:number;activeDays:number;points:number;me:boolean};
export type Leaderboard={participants:number;entries:LeaderboardEntry[];me:LeaderboardEntry|null;anonymous:boolean};
