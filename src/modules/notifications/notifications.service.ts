import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotificationType } from '../../common/enums/notification.enum';
import { Notification } from './entities/notification.entity';

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(Notification)
    private readonly notificationsRepository: Repository<Notification>,
  ) {}

  create(data: {
    userId: string;
    organisationId?: string | null;
    type: NotificationType;
    title: string;
    message: string;
    relatedEntityType?: string;
    relatedEntityId?: string;
  }): Promise<Notification> {
    const notification = this.notificationsRepository.create({
      userId: data.userId,
      organisationId: data.organisationId ?? null,
      type: data.type,
      title: data.title,
      message: data.message,
      relatedEntityType: data.relatedEntityType ?? null,
      relatedEntityId: data.relatedEntityId ?? null,
    });
    return this.notificationsRepository.save(notification);
  }

  listForUser(userId: string): Promise<Notification[]> {
    return this.notificationsRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  async markRead(userId: string, id: string): Promise<Notification> {
    const notification = await this.notificationsRepository.findOne({
      where: { id },
    });
    if (!notification) {
      throw new NotFoundException('Notification not found');
    }
    if (notification.userId !== userId) {
      throw new ForbiddenException();
    }
    notification.isRead = true;
    return this.notificationsRepository.save(notification);
  }
}
