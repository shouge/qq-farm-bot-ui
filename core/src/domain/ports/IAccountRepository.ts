export interface Account {
  id: string;
  name: string;
  code: string;
  platform: string;
  gid?: string;
  openId?: string;
  uin?: string;
  qq?: string;
  avatar?: string;
  createdAt?: number;
  updatedAt?: number;
}

export interface AccountsData {
  accounts: Account[];
  nextId: number;
}

export interface IAccountRepository {
  getAccounts(): AccountsData;
  findById(id: string): Account | undefined;
  addOrUpdate(account: Partial<Account> & { id?: string }): AccountsData;
  delete(id: string): AccountsData;
}
