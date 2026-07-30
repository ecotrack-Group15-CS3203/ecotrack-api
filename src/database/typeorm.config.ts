import { ConfigService } from '@nestjs/config';
import { DataSourceOptions } from 'typeorm';

export function buildTypeOrmOptions(config: ConfigService): DataSourceOptions {
  return {
    type: 'postgres',
    host: config.get<string>('DB_HOST'),
    port: config.get<number>('DB_PORT'),
    username: config.get<string>('DB_USER'),
    password: config.get<string>('DB_PASSWORD'),
    database: config.get<string>('DB_NAME'),
    entities: [__dirname + '/../**/*.entity{.ts,.js}'],
    migrations: [__dirname + '/migrations/*{.ts,.js}'],
    synchronize: false,
    logging: config.get<string>('NODE_ENV') === 'development',
  };
}
