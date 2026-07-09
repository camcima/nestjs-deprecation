import 'reflect-metadata';

describe('toolchain smoke test', () => {
  it('runs TypeScript with decorator metadata support', () => {
    expect(Reflect.defineMetadata).toBeTypeOf('function');
  });
});
