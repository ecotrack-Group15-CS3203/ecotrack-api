import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog } from './entities/audit-log.entity';

@Injectable()
export class AuditLogService {
  constructor(
    @InjectRepository(AuditLog)
    private readonly auditLogRepository: Repository<AuditLog>,
  ) {}

  record(data: {
    organisationId?: string | null;
    actingUserId?: string | null;
    action: string;
    entityType: string;
    entityId?: string | null;
    metadata?: Record<string, unknown> | null;
  }): Promise<AuditLog> {
    const entry = this.auditLogRepository.create({
      organisationId: data.organisationId ?? null,
      actingUserId: data.actingUserId ?? null,
      action: data.action,
      entityType: data.entityType,
      entityId: data.entityId ?? null,
      metadata: data.metadata ?? null,
    });
    return this.auditLogRepository.save(entry);
  }

  listForOrg(organisationId: string): Promise<AuditLog[]> {
    return this.auditLogRepository.find({
      where: { organisationId },
      order: { createdAt: 'DESC' },
      take: 200,
    });
  }

  listPlatformWide(): Promise<AuditLog[]> {
    return this.auditLogRepository.find({
      order: { createdAt: 'DESC' },
      take: 200,
    });
  }
}
