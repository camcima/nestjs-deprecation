import 'reflect-metadata';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { DEPRECATION_MODULE_OPTIONS } from '../../src/deprecation.constants';
import { DeprecationInterceptor } from '../../src/deprecation.interceptor';
import { DeprecationModuleOptions } from '../../src/deprecation.interfaces';
import { DeprecationModule } from '../../src/deprecation.module';

describe('DeprecationModule', () => {
  it('forRoot provides the options and registers a global interceptor', async () => {
    const listener = () => undefined;
    const moduleRef = await Test.createTestingModule({
      imports: [DeprecationModule.forRoot({ enabled: true, onDeprecatedCall: listener })],
    }).compile();

    const options = moduleRef.get<DeprecationModuleOptions>(DEPRECATION_MODULE_OPTIONS);
    expect(options).toEqual({ enabled: true, onDeprecatedCall: listener });

    const dynamicModule = DeprecationModule.forRoot();
    expect(dynamicModule.providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ provide: APP_INTERCEPTOR, useClass: DeprecationInterceptor }),
      ]),
    );
  });

  it('forRoot defaults to empty options', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DeprecationModule.forRoot()],
    }).compile();
    expect(moduleRef.get<DeprecationModuleOptions>(DEPRECATION_MODULE_OPTIONS)).toEqual({});
  });

  it('forRootAsync resolves options from a factory', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        DeprecationModule.forRootAsync({
          useFactory: async () => ({ enabled: false }),
        }),
      ],
    }).compile();
    expect(moduleRef.get<DeprecationModuleOptions>(DEPRECATION_MODULE_OPTIONS)).toEqual({
      enabled: false,
    });

    const dynamicModule = DeprecationModule.forRootAsync({
      useFactory: async () => ({ enabled: false }),
    });
    expect(dynamicModule.providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ provide: APP_INTERCEPTOR, useClass: DeprecationInterceptor }),
      ]),
    );
  });
});
