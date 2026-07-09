import { DynamicModule, FactoryProvider, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { DEPRECATION_MODULE_OPTIONS } from './deprecation.constants';
import { DeprecationInterceptor } from './deprecation.interceptor';
import { DeprecationModuleOptions } from './deprecation.interfaces';

export interface DeprecationModuleAsyncOptions {
  imports?: DynamicModule['imports'];
  useFactory: (...args: any[]) => DeprecationModuleOptions | Promise<DeprecationModuleOptions>;
  inject?: FactoryProvider['inject'];
}

@Module({})
export class DeprecationModule {
  static forRoot(options: DeprecationModuleOptions = {}): DynamicModule {
    return {
      module: DeprecationModule,
      providers: [
        { provide: DEPRECATION_MODULE_OPTIONS, useValue: options },
        { provide: APP_INTERCEPTOR, useClass: DeprecationInterceptor },
      ],
      exports: [DEPRECATION_MODULE_OPTIONS],
    };
  }

  static forRootAsync(asyncOptions: DeprecationModuleAsyncOptions): DynamicModule {
    return {
      module: DeprecationModule,
      imports: asyncOptions.imports ?? [],
      providers: [
        {
          provide: DEPRECATION_MODULE_OPTIONS,
          useFactory: asyncOptions.useFactory,
          inject: asyncOptions.inject ?? [],
        },
        { provide: APP_INTERCEPTOR, useClass: DeprecationInterceptor },
      ],
      exports: [DEPRECATION_MODULE_OPTIONS],
    };
  }
}
