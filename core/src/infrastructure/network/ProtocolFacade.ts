import type { INetworkClient, UserStateSnapshot } from '../../domain/ports/INetworkClient';
import { types } from '../../utils/proto';
import { toLong } from '../../utils/utils';

export interface HarvestReply {
  land: Array<{
    id: bigint;
    plant?: {
      id?: bigint;
      phases?: Array<{
        phase?: number;
        begin_time?: bigint;
      }>;
    };
    [key: string]: unknown;
  }>;
}

export interface WaterLandReply {
  operation_limits?: Array<{
    id: bigint;
    day_times: bigint;
    day_times_lt: bigint;
    day_exp_times: bigint;
    day_ex_times_lt: bigint;
  }>;
}

export interface WeedOutReply extends WaterLandReply {}
export interface InsecticideReply extends WaterLandReply {}

export interface FertilizeReply {
  land?: Array<{
    id: bigint;
    [key: string]: unknown;
  }>;
}

export interface RemovePlantReply {
  land?: Array<{ id: bigint; [key: string]: unknown }>;
}

export interface UpgradeLandReply {
  land?: { id: bigint; level: bigint; [key: string]: unknown };
}

export interface UnlockLandReply {
  land?: { id: bigint; unlocked: boolean; [key: string]: unknown };
}

export interface AllLandsReply {
  lands: Array<{
    id: bigint;
    unlocked: boolean;
    level: bigint;
    max_level: bigint;
    lands_level: bigint;
    land_size: bigint;
    could_unlock: boolean;
    could_upgrade: boolean;
    master_land_id?: bigint;
    slave_land_ids?: bigint[];
    status?: string;
    plant?: {
      id?: bigint;
      name?: string;
      phases?: Array<{
        phase?: number;
        begin_time?: bigint;
        end_time?: bigint;
        dry_time?: bigint;
        weeds_time?: bigint;
        insect_time?: bigint;
        ferts_used?: Record<string, bigint>;
        [key: string]: unknown;
      }>;
      season?: bigint;
      dry_num?: bigint;
      weed_owners?: bigint[];
      insect_owners?: bigint[];
      stealable?: boolean;
      left_inorc_fert_times?: bigint;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  }>;
  operation_limits?: WaterLandReply['operation_limits'];
}

export interface ShopInfoReply {
  goods_list?: Array<{
    id: bigint;
    item_id: bigint;
    price: bigint;
    limit_count: bigint;
    bought_num: bigint;
    unlocked: boolean;
    conds: Array<{ type: bigint; param: bigint }>;
    [key: string]: unknown;
  }>;
}

export interface BuyGoodsReply {
  get_items?: Array<{ id: bigint; count: bigint }>;
  cost_items?: Array<{ id: bigint; count: bigint }>;
  [key: string]: unknown;
}

export interface PlantReply {
  land?: Array<{ id: bigint; [key: string]: unknown }>;
}

export interface VisitEnterReply {
  lands: AllLandsReply['lands'];
}

export interface VisitLeaveReply {}

export interface SyncAllFriendsReply {
  game_friends: Array<{
    gid: bigint;
    name?: string;
    remark?: string;
    avatar_url?: string;
    level?: bigint;
    plant?: {
      steal_plant_num?: bigint;
      dry_num?: bigint;
      weed_num?: bigint;
      insect_num?: bigint;
    };
    [key: string]: unknown;
  }>;
}

export interface GetGameFriendsReply extends SyncAllFriendsReply {}

export interface GetApplicationsReply {
  applications?: Array<{
    gid: bigint;
    name?: string;
    [key: string]: unknown;
  }>;
}

export interface AcceptFriendsReply {
  friends?: Array<{ gid: bigint; name?: string; remark?: string }>;
}

export interface CheckCanOperateReply {
  can_operate: boolean;
  can_steal_num: bigint;
}

export class ProtocolFacade {
  constructor(private readonly network: INetworkClient) {}

  getUserState(): UserStateSnapshot {
    return this.network.getUserState();
  }

  // ========== Farm APIs ==========
  async getAllLands(): Promise<AllLandsReply> {
    const body = types.AllLandsRequest.encode(types.AllLandsRequest.create({})).finish() as Buffer;
    const { body: replyBody } = await this.network.sendAsync('gamepb.plantpb.PlantService', 'AllLands', body);
    return types.AllLandsReply.decode(replyBody as Buffer) as unknown as AllLandsReply;
  }

  async harvest(landIds: number[], hostGid: number): Promise<HarvestReply> {
    const body = types.HarvestRequest.encode(
      types.HarvestRequest.create({ land_ids: landIds, host_gid: toLong(hostGid), is_all: true })
    ).finish() as Buffer;
    const { body: replyBody } = await this.network.sendAsync('gamepb.plantpb.PlantService', 'Harvest', body);
    return types.HarvestReply.decode(replyBody as Buffer) as unknown as HarvestReply;
  }

  async waterLand(landIds: number[], hostGid: number): Promise<WaterLandReply> {
    const body = types.WaterLandRequest.encode(
      types.WaterLandRequest.create({ land_ids: landIds, host_gid: toLong(hostGid) })
    ).finish() as Buffer;
    const { body: replyBody } = await this.network.sendAsync('gamepb.plantpb.PlantService', 'WaterLand', body);
    return types.WaterLandReply.decode(replyBody as Buffer) as unknown as WaterLandReply;
  }

  async weedOut(landIds: number[], hostGid: number): Promise<WeedOutReply> {
    const body = types.WeedOutRequest.encode(
      types.WeedOutRequest.create({ land_ids: landIds, host_gid: toLong(hostGid) })
    ).finish() as Buffer;
    const { body: replyBody } = await this.network.sendAsync('gamepb.plantpb.PlantService', 'WeedOut', body);
    return types.WeedOutReply.decode(replyBody as Buffer) as unknown as WeedOutReply;
  }

  async insecticide(landIds: number[], hostGid: number): Promise<InsecticideReply> {
    const body = types.InsecticideRequest.encode(
      types.InsecticideRequest.create({ land_ids: landIds, host_gid: toLong(hostGid) })
    ).finish() as Buffer;
    const { body: replyBody } = await this.network.sendAsync('gamepb.plantpb.PlantService', 'Insecticide', body);
    return types.InsecticideReply.decode(replyBody as Buffer) as unknown as InsecticideReply;
  }

  async fertilize(landIds: number[], fertilizerId: number): Promise<FertilizeReply> {
    const body = types.FertilizeRequest.encode(
      types.FertilizeRequest.create({
        land_ids: landIds.map((id) => toLong(id)),
        fertilizer_id: toLong(fertilizerId),
      })
    ).finish() as Buffer;
    const { body: replyBody } = await this.network.sendAsync('gamepb.plantpb.PlantService', 'Fertilize', body);
    return types.FertilizeReply.decode(replyBody as Buffer) as unknown as FertilizeReply;
  }

  async fertilizeSingle(landId: number, fertilizerId: number): Promise<FertilizeReply> {
    return this.fertilize([landId], fertilizerId);
  }

  async removePlant(landIds: number[]): Promise<RemovePlantReply> {
    const body = types.RemovePlantRequest.encode(
      types.RemovePlantRequest.create({ land_ids: landIds.map((id) => toLong(id)) })
    ).finish() as Buffer;
    const { body: replyBody } = await this.network.sendAsync('gamepb.plantpb.PlantService', 'RemovePlant', body);
    return types.RemovePlantReply.decode(replyBody as Buffer) as unknown as RemovePlantReply;
  }

  async upgradeLand(landId: number): Promise<UpgradeLandReply> {
    const body = types.UpgradeLandRequest.encode(types.UpgradeLandRequest.create({ land_id: toLong(landId) })).finish() as Buffer;
    const { body: replyBody } = await this.network.sendAsync('gamepb.plantpb.PlantService', 'UpgradeLand', body);
    return types.UpgradeLandReply.decode(replyBody as Buffer) as unknown as UpgradeLandReply;
  }

  async unlockLand(landId: number, doShared = false): Promise<UnlockLandReply> {
    const body = types.UnlockLandRequest.encode(
      types.UnlockLandRequest.create({ land_id: toLong(landId), do_shared: doShared })
    ).finish() as Buffer;
    const { body: replyBody } = await this.network.sendAsync('gamepb.plantpb.PlantService', 'UnlockLand', body);
    return types.UnlockLandReply.decode(replyBody as Buffer) as unknown as UnlockLandReply;
  }

  // ========== Shop / Plant APIs ==========
  async getShopInfo(shopId: number): Promise<ShopInfoReply> {
    const body = types.ShopInfoRequest.encode(types.ShopInfoRequest.create({ shop_id: toLong(shopId) })).finish() as Buffer;
    const { body: replyBody } = await this.network.sendAsync('gamepb.shoppb.ShopService', 'ShopInfo', body);
    return types.ShopInfoReply.decode(replyBody as Buffer) as unknown as ShopInfoReply;
  }

  async buyGoods(goodsId: number, num: number, price: number): Promise<BuyGoodsReply> {
    const body = types.BuyGoodsRequest.encode(
      types.BuyGoodsRequest.create({ goods_id: toLong(goodsId), num: toLong(num), price: toLong(price) })
    ).finish() as Buffer;
    const { body: replyBody } = await this.network.sendAsync('gamepb.shoppb.ShopService', 'BuyGoods', body);
    return types.BuyGoodsReply.decode(replyBody as Buffer) as unknown as BuyGoodsReply;
  }

  async plantRaw(seedId: number, landIds: number[]): Promise<PlantReply> {
    const writer = (await import('protobufjs')).Writer.create();
    const itemWriter = writer.uint32(18).fork();
    itemWriter.uint32(8).int64(toLong(seedId));
    const idsWriter = itemWriter.uint32(18).fork();
    for (const id of landIds) {
      idsWriter.int64(toLong(id));
    }
    idsWriter.ldelim();
    itemWriter.ldelim();
    const body = writer.finish() as Buffer as Buffer;
    const { body: replyBody } = await this.network.sendAsync('gamepb.plantpb.PlantService', 'Plant', body);
    return types.PlantReply.decode(replyBody as Buffer) as unknown as PlantReply;
  }

  // ========== Friend APIs ==========
  async syncAllFriends(): Promise<SyncAllFriendsReply> {
    const reqType = (types as Record<string, unknown>).SyncAllRequest || types.SyncAllFriendsRequest;
    const repType = (types as Record<string, unknown>).SyncAllReply || types.SyncAllFriendsReply;
    const body = (reqType as { create: (v: unknown) => unknown; encode: (v: unknown) => { finish: () => Buffer } }).encode((reqType as { create: (v: unknown) => unknown }).create({ open_ids: [] })).finish() as Buffer;
    const { body: replyBody } = await this.network.sendAsync('gamepb.friendpb.FriendService', 'SyncAll', body);
    return (repType as { decode: (b: Buffer) => SyncAllFriendsReply }).decode(replyBody as Buffer);
  }

  async getAllFriends(): Promise<SyncAllFriendsReply> {
    const body = types.GetAllFriendsRequest.encode(types.GetAllFriendsRequest.create({})).finish() as Buffer;
    const { body: replyBody } = await this.network.sendAsync('gamepb.friendpb.FriendService', 'GetAll', body);
    return types.GetAllFriendsReply.decode(replyBody as Buffer) as unknown as SyncAllFriendsReply;
  }

  async getGameFriends(gids: number[]): Promise<GetGameFriendsReply> {
    const body = types.GetGameFriendsRequest.encode(
      types.GetGameFriendsRequest.create({ gids: gids.map((g) => toLong(g)) })
    ).finish() as Buffer;
    const { body: replyBody } = await this.network.sendAsync('gamepb.friendpb.FriendService', 'GetGameFriends', body);
    return types.GetAllFriendsReply.decode(replyBody as Buffer) as unknown as GetGameFriendsReply;
  }

  async getApplications(): Promise<GetApplicationsReply> {
    const body = types.GetApplicationsRequest.encode(types.GetApplicationsRequest.create({})).finish() as Buffer;
    const { body: replyBody } = await this.network.sendAsync('gamepb.friendpb.FriendService', 'GetApplications', body);
    return types.GetApplicationsReply.decode(replyBody as Buffer) as unknown as GetApplicationsReply;
  }

  async acceptFriends(gids: number[]): Promise<AcceptFriendsReply> {
    const body = types.AcceptFriendsRequest.encode(
      types.AcceptFriendsRequest.create({ friend_gids: gids.map((g) => toLong(g)) })
    ).finish() as Buffer;
    const { body: replyBody } = await this.network.sendAsync('gamepb.friendpb.FriendService', 'AcceptFriends', body);
    return types.AcceptFriendsReply.decode(replyBody as Buffer) as unknown as AcceptFriendsReply;
  }

  async enterFriendFarm(friendGid: number): Promise<VisitEnterReply> {
    const body = types.VisitEnterRequest.encode(
      types.VisitEnterRequest.create({ host_gid: toLong(friendGid), reason: 2 })
    ).finish() as Buffer;
    const { body: replyBody } = await this.network.sendAsync('gamepb.visitpb.VisitService', 'Enter', body);
    return types.VisitEnterReply.decode(replyBody as Buffer) as unknown as VisitEnterReply;
  }

  async leaveFriendFarm(friendGid: number): Promise<VisitLeaveReply> {
    const body = types.VisitLeaveRequest.encode(types.VisitLeaveRequest.create({ host_gid: toLong(friendGid) })).finish() as Buffer;
    try {
      await this.network.sendAsync('gamepb.visitpb.VisitService', 'Leave', body);
    } catch {
      // ignore leave errors
    }
    return {};
  }

  async checkCanOperateRemote(friendGid: number, operationId: number): Promise<CheckCanOperateReply> {
    if (!types.CheckCanOperateRequest || !types.CheckCanOperateReply) {
      return { can_operate: true, can_steal_num: BigInt(0) };
    }
    try {
      const body = types.CheckCanOperateRequest.encode(
        types.CheckCanOperateRequest.create({ host_gid: toLong(friendGid), operation_id: toLong(operationId) })
      ).finish() as Buffer;
      const { body: replyBody } = await this.network.sendAsync('gamepb.plantpb.PlantService', 'CheckCanOperate', body);
      return types.CheckCanOperateReply.decode(replyBody as Buffer) as unknown as CheckCanOperateReply;
    } catch {
      return { can_operate: true, can_steal_num: BigInt(0) };
    }
  }
}
