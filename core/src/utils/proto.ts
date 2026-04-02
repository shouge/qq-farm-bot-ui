/**
 * Proto 加载与消息类型管理
 */

import protobuf from 'protobufjs';
import fs from 'node:fs';
import path from 'node:path';
import { log } from './utils';

let root: protobuf.Root | null = null;

// Define the types interface based on all available message types
interface ProtoTypes {
  // Gateway
  GateMessage: protobuf.Type;
  GateMeta: protobuf.Type;
  EventMessage: protobuf.Type;
  // User
  LoginRequest: protobuf.Type;
  LoginReply: protobuf.Type;
  HeartbeatRequest: protobuf.Type;
  HeartbeatReply: protobuf.Type;
  ReportArkClickRequest: protobuf.Type;
  ReportArkClickReply: protobuf.Type;
  BasicNotify: protobuf.Type;
  // Farm
  AllLandsRequest: protobuf.Type;
  AllLandsReply: protobuf.Type;
  HarvestRequest: protobuf.Type;
  HarvestReply: protobuf.Type;
  WaterLandRequest: protobuf.Type;
  WaterLandReply: protobuf.Type;
  WeedOutRequest: protobuf.Type;
  WeedOutReply: protobuf.Type;
  InsecticideRequest: protobuf.Type;
  InsecticideReply: protobuf.Type;
  RemovePlantRequest: protobuf.Type;
  RemovePlantReply: protobuf.Type;
  PutInsectsRequest: protobuf.Type;
  PutInsectsReply: protobuf.Type;
  PutWeedsRequest: protobuf.Type;
  PutWeedsReply: protobuf.Type;
  UpgradeLandRequest: protobuf.Type;
  UpgradeLandReply: protobuf.Type;
  UnlockLandRequest: protobuf.Type;
  UnlockLandReply: protobuf.Type;
  CheckCanOperateRequest: protobuf.Type;
  CheckCanOperateReply: protobuf.Type;
  FertilizeRequest: protobuf.Type;
  FertilizeReply: protobuf.Type;
  PlantRequest: protobuf.Type;
  PlantReply: protobuf.Type;
  LandsNotify: protobuf.Type;
  // Bag/Warehouse
  BagRequest: protobuf.Type;
  BagReply: protobuf.Type;
  SellRequest: protobuf.Type;
  SellReply: protobuf.Type;
  UseRequest: protobuf.Type;
  UseReply: protobuf.Type;
  BatchUseRequest: protobuf.Type;
  BatchUseReply: protobuf.Type;
  ItemNotify: protobuf.Type;
  // Shop
  ShopProfilesRequest: protobuf.Type;
  ShopProfilesReply: protobuf.Type;
  ShopInfoRequest: protobuf.Type;
  ShopInfoReply: protobuf.Type;
  BuyGoodsRequest: protobuf.Type;
  BuyGoodsReply: protobuf.Type;
  GoodsUnlockNotify: protobuf.Type;
  // Mall
  GetMonthCardInfosRequest: protobuf.Type;
  GetMonthCardInfosReply: protobuf.Type;
  ClaimMonthCardRewardRequest: protobuf.Type;
  ClaimMonthCardRewardReply: protobuf.Type;
  GetTodayClaimStatusRequest: protobuf.Type;
  GetTodayClaimStatusReply: protobuf.Type;
  ClaimRedPacketRequest: protobuf.Type;
  ClaimRedPacketReply: protobuf.Type;
  GetMallListBySlotTypeRequest: protobuf.Type;
  GetMallListBySlotTypeResponse: protobuf.Type;
  MallGoods: protobuf.Type;
  PurchaseRequest: protobuf.Type;
  PurchaseResponse: protobuf.Type;
  // QQ VIP
  GetDailyGiftStatusRequest: protobuf.Type;
  GetDailyGiftStatusReply: protobuf.Type;
  ClaimDailyGiftRequest: protobuf.Type;
  ClaimDailyGiftReply: protobuf.Type;
  // Share
  CheckCanShareRequest: protobuf.Type;
  CheckCanShareReply: protobuf.Type;
  ReportShareRequest: protobuf.Type;
  ReportShareReply: protobuf.Type;
  ClaimShareRewardRequest: protobuf.Type;
  ClaimShareRewardReply: protobuf.Type;
  // Illustrated
  GetIllustratedListV2Request: protobuf.Type;
  GetIllustratedListV2Reply: protobuf.Type;
  ClaimAllRewardsV2Request: protobuf.Type;
  ClaimAllRewardsV2Reply: protobuf.Type;
  // Friends
  GetAllFriendsRequest: protobuf.Type;
  GetAllFriendsReply: protobuf.Type;
  SyncAllRequest: protobuf.Type;
  SyncAllReply: protobuf.Type;
  SyncAllFriendsRequest: protobuf.Type;
  SyncAllFriendsReply: protobuf.Type;
  GetGameFriendsRequest: protobuf.Type;
  GetGameFriendsReply: protobuf.Type;
  GetApplicationsRequest: protobuf.Type;
  GetApplicationsReply: protobuf.Type;
  AcceptFriendsRequest: protobuf.Type;
  AcceptFriendsReply: protobuf.Type;
  FriendApplicationReceivedNotify: protobuf.Type;
  FriendAddedNotify: protobuf.Type;
  InteractRecordsRequest: protobuf.Type;
  InteractRecordsReply: protobuf.Type;
  // Visit
  VisitEnterRequest: protobuf.Type;
  VisitEnterReply: protobuf.Type;
  VisitLeaveRequest: protobuf.Type;
  VisitLeaveReply: protobuf.Type;
  // Task
  TaskInfoRequest: protobuf.Type;
  TaskInfoReply: protobuf.Type;
  ClaimTaskRewardRequest: protobuf.Type;
  ClaimTaskRewardReply: protobuf.Type;
  BatchClaimTaskRewardRequest: protobuf.Type;
  BatchClaimTaskRewardReply: protobuf.Type;
  ClaimDailyRewardRequest: protobuf.Type;
  ClaimDailyRewardReply: protobuf.Type;
  TaskInfoNotify: protobuf.Type;
  // Email
  GetEmailListRequest: protobuf.Type;
  GetEmailListReply: protobuf.Type;
  ClaimEmailRequest: protobuf.Type;
  ClaimEmailReply: protobuf.Type;
  BatchClaimEmailRequest: protobuf.Type;
  BatchClaimEmailReply: protobuf.Type;
  // Other
  KickoutNotify: protobuf.Type;
}

const types = {} as ProtoTypes & Record<string, protobuf.Type>;

// Proto 文件所在目录
const PROTO_DIR = path.dirname(require.resolve('../proto/game.proto'));

const typeMappings: Array<[string, string]> = [
  // 网关
  ['GateMessage', 'gatepb.Message'],
  ['GateMeta', 'gatepb.Meta'],
  ['EventMessage', 'gatepb.EventMessage'],
  // 用户
  ['LoginRequest', 'gamepb.userpb.LoginRequest'],
  ['LoginReply', 'gamepb.userpb.LoginReply'],
  ['HeartbeatRequest', 'gamepb.userpb.HeartbeatRequest'],
  ['HeartbeatReply', 'gamepb.userpb.HeartbeatReply'],
  ['ReportArkClickRequest', 'gamepb.userpb.ReportArkClickRequest'],
  ['ReportArkClickReply', 'gamepb.userpb.ReportArkClickReply'],
  ['BasicNotify', 'gamepb.userpb.BasicNotify'],
  // 农场
  ['AllLandsRequest', 'gamepb.plantpb.AllLandsRequest'],
  ['AllLandsReply', 'gamepb.plantpb.AllLandsReply'],
  ['HarvestRequest', 'gamepb.plantpb.HarvestRequest'],
  ['HarvestReply', 'gamepb.plantpb.HarvestReply'],
  ['WaterLandRequest', 'gamepb.plantpb.WaterLandRequest'],
  ['WaterLandReply', 'gamepb.plantpb.WaterLandReply'],
  ['WeedOutRequest', 'gamepb.plantpb.WeedOutRequest'],
  ['WeedOutReply', 'gamepb.plantpb.WeedOutReply'],
  ['InsecticideRequest', 'gamepb.plantpb.InsecticideRequest'],
  ['InsecticideReply', 'gamepb.plantpb.InsecticideReply'],
  ['RemovePlantRequest', 'gamepb.plantpb.RemovePlantRequest'],
  ['RemovePlantReply', 'gamepb.plantpb.RemovePlantReply'],
  ['PutInsectsRequest', 'gamepb.plantpb.PutInsectsRequest'],
  ['PutInsectsReply', 'gamepb.plantpb.PutInsectsReply'],
  ['PutWeedsRequest', 'gamepb.plantpb.PutWeedsRequest'],
  ['PutWeedsReply', 'gamepb.plantpb.PutWeedsReply'],
  ['UpgradeLandRequest', 'gamepb.plantpb.UpgradeLandRequest'],
  ['UpgradeLandReply', 'gamepb.plantpb.UpgradeLandReply'],
  ['UnlockLandRequest', 'gamepb.plantpb.UnlockLandRequest'],
  ['UnlockLandReply', 'gamepb.plantpb.UnlockLandReply'],
  ['CheckCanOperateRequest', 'gamepb.plantpb.CheckCanOperateRequest'],
  ['CheckCanOperateReply', 'gamepb.plantpb.CheckCanOperateReply'],
  ['FertilizeRequest', 'gamepb.plantpb.FertilizeRequest'],
  ['FertilizeReply', 'gamepb.plantpb.FertilizeReply'],
  ['PlantRequest', 'gamepb.plantpb.PlantRequest'],
  ['PlantReply', 'gamepb.plantpb.PlantReply'],
  ['LandsNotify', 'gamepb.plantpb.LandsNotify'],
  // 背包/仓库
  ['BagRequest', 'gamepb.itempb.BagRequest'],
  ['BagReply', 'gamepb.itempb.BagReply'],
  ['SellRequest', 'gamepb.itempb.SellRequest'],
  ['SellReply', 'gamepb.itempb.SellReply'],
  ['UseRequest', 'gamepb.itempb.UseRequest'],
  ['UseReply', 'gamepb.itempb.UseReply'],
  ['BatchUseRequest', 'gamepb.itempb.BatchUseRequest'],
  ['BatchUseReply', 'gamepb.itempb.BatchUseReply'],
  ['ItemNotify', 'gamepb.itempb.ItemNotify'],
  // 商店
  ['ShopProfilesRequest', 'gamepb.shoppb.ShopProfilesRequest'],
  ['ShopProfilesReply', 'gamepb.shoppb.ShopProfilesReply'],
  ['ShopInfoRequest', 'gamepb.shoppb.ShopInfoRequest'],
  ['ShopInfoReply', 'gamepb.shoppb.ShopInfoReply'],
  ['BuyGoodsRequest', 'gamepb.shoppb.BuyGoodsRequest'],
  ['BuyGoodsReply', 'gamepb.shoppb.BuyGoodsReply'],
  ['GoodsUnlockNotify', 'gamepb.shoppb.GoodsUnlockNotify'],
  // 商城
  ['GetMonthCardInfosRequest', 'gamepb.mallpb.GetMonthCardInfosRequest'],
  ['GetMonthCardInfosReply', 'gamepb.mallpb.GetMonthCardInfosReply'],
  ['ClaimMonthCardRewardRequest', 'gamepb.mallpb.ClaimMonthCardRewardRequest'],
  ['ClaimMonthCardRewardReply', 'gamepb.mallpb.ClaimMonthCardRewardReply'],
  ['GetTodayClaimStatusRequest', 'gamepb.redpacketpb.GetTodayClaimStatusRequest'],
  ['GetTodayClaimStatusReply', 'gamepb.redpacketpb.GetTodayClaimStatusReply'],
  ['ClaimRedPacketRequest', 'gamepb.redpacketpb.ClaimRedPacketRequest'],
  ['ClaimRedPacketReply', 'gamepb.redpacketpb.ClaimRedPacketReply'],
  ['GetMallListBySlotTypeRequest', 'gamepb.mallpb.GetMallListBySlotTypeRequest'],
  ['GetMallListBySlotTypeResponse', 'gamepb.mallpb.GetMallListBySlotTypeResponse'],
  ['MallGoods', 'gamepb.mallpb.MallGoods'],
  ['PurchaseRequest', 'gamepb.mallpb.PurchaseRequest'],
  ['PurchaseResponse', 'gamepb.mallpb.PurchaseResponse'],
  // QQ会员
  ['GetDailyGiftStatusRequest', 'gamepb.qqvippb.GetDailyGiftStatusRequest'],
  ['GetDailyGiftStatusReply', 'gamepb.qqvippb.GetDailyGiftStatusReply'],
  ['ClaimDailyGiftRequest', 'gamepb.qqvippb.ClaimDailyGiftRequest'],
  ['ClaimDailyGiftReply', 'gamepb.qqvippb.ClaimDailyGiftReply'],
  // 分享
  ['CheckCanShareRequest', 'gamepb.sharepb.CheckCanShareRequest'],
  ['CheckCanShareReply', 'gamepb.sharepb.CheckCanShareReply'],
  ['ReportShareRequest', 'gamepb.sharepb.ReportShareRequest'],
  ['ReportShareReply', 'gamepb.sharepb.ReportShareReply'],
  ['ClaimShareRewardRequest', 'gamepb.sharepb.ClaimShareRewardRequest'],
  ['ClaimShareRewardReply', 'gamepb.sharepb.ClaimShareRewardReply'],
  // 图鉴
  ['GetIllustratedListV2Request', 'gamepb.illustratedpb.GetIllustratedListV2Request'],
  ['GetIllustratedListV2Reply', 'gamepb.illustratedpb.GetIllustratedListV2Reply'],
  ['ClaimAllRewardsV2Request', 'gamepb.illustratedpb.ClaimAllRewardsV2Request'],
  ['ClaimAllRewardsV2Reply', 'gamepb.illustratedpb.ClaimAllRewardsV2Reply'],
  // 好友
  ['GetAllFriendsRequest', 'gamepb.friendpb.GetAllRequest'],
  ['GetAllFriendsReply', 'gamepb.friendpb.GetAllReply'],
  ['SyncAllRequest', 'gamepb.friendpb.SyncAllRequest'],
  ['SyncAllReply', 'gamepb.friendpb.SyncAllReply'],
  ['SyncAllFriendsRequest', 'gamepb.friendpb.SyncAllRequest'],
  ['SyncAllFriendsReply', 'gamepb.friendpb.SyncAllReply'],
  ['GetGameFriendsRequest', 'gamepb.friendpb.GetGameFriendsRequest'],
  ['GetGameFriendsReply', 'gamepb.friendpb.GetGameFriendsReply'],
  ['GetApplicationsRequest', 'gamepb.friendpb.GetApplicationsRequest'],
  ['GetApplicationsReply', 'gamepb.friendpb.GetApplicationsReply'],
  ['AcceptFriendsRequest', 'gamepb.friendpb.AcceptFriendsRequest'],
  ['AcceptFriendsReply', 'gamepb.friendpb.AcceptFriendsReply'],
  ['FriendApplicationReceivedNotify', 'gamepb.friendpb.FriendApplicationReceivedNotify'],
  ['FriendAddedNotify', 'gamepb.friendpb.FriendAddedNotify'],
  ['InteractRecordsRequest', 'gamepb.interactpb.InteractRecordsRequest'],
  ['InteractRecordsReply', 'gamepb.interactpb.InteractRecordsReply'],
  // 访问
  ['VisitEnterRequest', 'gamepb.visitpb.EnterRequest'],
  ['VisitEnterReply', 'gamepb.visitpb.EnterReply'],
  ['VisitLeaveRequest', 'gamepb.visitpb.LeaveRequest'],
  ['VisitLeaveReply', 'gamepb.visitpb.LeaveReply'],
  // 任务
  ['TaskInfoRequest', 'gamepb.taskpb.TaskInfoRequest'],
  ['TaskInfoReply', 'gamepb.taskpb.TaskInfoReply'],
  ['ClaimTaskRewardRequest', 'gamepb.taskpb.ClaimTaskRewardRequest'],
  ['ClaimTaskRewardReply', 'gamepb.taskpb.ClaimTaskRewardReply'],
  ['BatchClaimTaskRewardRequest', 'gamepb.taskpb.BatchClaimTaskRewardRequest'],
  ['BatchClaimTaskRewardReply', 'gamepb.taskpb.BatchClaimTaskRewardReply'],
  ['ClaimDailyRewardRequest', 'gamepb.taskpb.ClaimDailyRewardRequest'],
  ['ClaimDailyRewardReply', 'gamepb.taskpb.ClaimDailyRewardReply'],
  ['TaskInfoNotify', 'gamepb.taskpb.TaskInfoNotify'],
  // 邮箱
  ['GetEmailListRequest', 'gamepb.emailpb.GetEmailListRequest'],
  ['GetEmailListReply', 'gamepb.emailpb.GetEmailListReply'],
  ['ClaimEmailRequest', 'gamepb.emailpb.ClaimEmailRequest'],
  ['ClaimEmailReply', 'gamepb.emailpb.ClaimEmailReply'],
  ['BatchClaimEmailRequest', 'gamepb.emailpb.BatchClaimEmailRequest'],
  ['BatchClaimEmailReply', 'gamepb.emailpb.BatchClaimEmailReply'],
  // 其他
  ['KickoutNotify', 'gatepb.KickoutNotify'],
];

export async function loadProto(): Promise<protobuf.Root> {
  if (root) return root;
  log('系统', '正在加载 Protobuf 定义...');
  root = new protobuf.Root();

  const protoFiles = fs.readdirSync(PROTO_DIR)
    .filter(f => f.endsWith('.proto'))
    .map(f => path.join(PROTO_DIR, f));

  await root.load(protoFiles, { keepCase: true });

  for (const [typeName, fullName] of typeMappings) {
    types[typeName] = root.lookupType(fullName);
  }

  log('系统', 'Protobuf 定义加载完成');
  return root;
}

export function getRoot(): protobuf.Root | null {
  return root;
}

export { types };
