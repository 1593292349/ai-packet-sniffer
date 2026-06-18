/**
 * 存储层统一入口
 * 聚合底层 JsonStore + 4 个 Repository，对外暴露简单的类 DB 接口
 * 老的 `DB` 类用法保留向后兼容
 */
import { JsonStore } from './jsonStore';
import { AddressRepo } from './repos/address.repo';
import { ConversationRepo } from './repos/conversation.repo';
import { MessageRepo } from './repos/message.repo';
import { RawRepo } from './repos/raw.repo';

export * from './types';
export { JsonStore } from './jsonStore';
export { AddressRepo } from './repos/address.repo';
export { ConversationRepo } from './repos/conversation.repo';
export { MessageRepo } from './repos/message.repo';
export { RawRepo } from './repos/raw.repo';

export class Store {
  readonly json: JsonStore;
  readonly addresses: AddressRepo;
  readonly conversations: ConversationRepo;
  readonly messages: MessageRepo;
  readonly raws: RawRepo;

  constructor(filePath: string) {
    this.json = new JsonStore(filePath);
    this.addresses = new AddressRepo(this.json);
    this.conversations = new ConversationRepo(this.json);
    this.messages = new MessageRepo(this.json);
    this.raws = new RawRepo(this.json);
  }

  close() {
    this.json.close();
  }
}