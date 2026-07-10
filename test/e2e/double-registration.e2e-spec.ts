import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DeprecationModule } from '../../src';
import { OrdersController } from './app.fixture';

describe('duplicate DeprecationModule registration', () => {
  it('does not duplicate Link relations or telemetry when forRoot() is imported twice', async () => {
    const calls: string[] = [];

    @Module({
      imports: [
        DeprecationModule.forRoot({
          onDeprecatedCall: () => {
            calls.push('first');
          },
        }),
        DeprecationModule.forRoot({
          onDeprecatedCall: () => {
            calls.push('second');
          },
        }),
      ],
      controllers: [OrdersController],
    })
    class DoubleModule {}

    const moduleRef = await Test.createTestingModule({ imports: [DoubleModule] }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    try {
      const response = await request(app.getHttpServer()).get('/orders').expect(200);
      const link = String(response.headers.link ?? '');
      expect(link.match(/rel="deprecation"/g)).toHaveLength(1);
      expect(link.match(/rel="successor-version"/g)).toHaveLength(1);
      expect(calls).toHaveLength(1);
    } finally {
      await app.close();
    }
  });
});
