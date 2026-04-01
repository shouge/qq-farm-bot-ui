export class Container {
  private registry = new Map<string, () => unknown>();
  private singletons = new Map<string, unknown>();

  register<T>(token: string, factory: () => T): void {
    this.registry.set(token, factory as () => unknown);
  }

  resolve<T>(token: string): T {
    if (this.singletons.has(token)) {
      return this.singletons.get(token) as T;
    }
    const factory = this.registry.get(token);
    if (!factory) {
      throw new Error(`Service not registered: ${token}`);
    }
    const instance = factory();
    this.singletons.set(token, instance);
    return instance as T;
  }
}
