export interface FriendPreview {
  gid: number;
  name: string;
  avatarUrl: string;
  level: number;
  plant?: {
    stealNum: number;
    dryNum: number;
    weedNum: number;
    insectNum: number;
  } | null;
}

export interface FriendCandidate {
  gid: number;
  name: string;
  level: number;
  isProbe?: boolean;
  isPriority?: boolean;
  stealNum?: number;
  dryNum?: number;
  weedNum?: number;
  insectNum?: number;
}
