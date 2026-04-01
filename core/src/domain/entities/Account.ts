export class AccountEntity {
  constructor(
    public readonly id: string,
    public name: string,
    public code: string,
    public platform: string = 'qq',
    public gid: string = '',
    public openId: string = '',
    public uin: string = '',
    public qq: string = '',
    public avatar: string = '',
    public createdAt: number = Date.now(),
    public updatedAt: number = Date.now()
  ) {}

  update(fields: Partial<Omit<AccountEntity, 'id'>>): void {
    if (fields.name !== undefined) this.name = fields.name;
    if (fields.code !== undefined) this.code = fields.code;
    if (fields.platform !== undefined) this.platform = fields.platform;
    if (fields.gid !== undefined) this.gid = fields.gid;
    if (fields.openId !== undefined) this.openId = fields.openId;
    if (fields.uin !== undefined) this.uin = fields.uin;
    if (fields.qq !== undefined) this.qq = fields.qq;
    if (fields.avatar !== undefined) this.avatar = fields.avatar;
    this.updatedAt = Date.now();
  }
}
