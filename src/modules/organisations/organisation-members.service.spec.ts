import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { OrganisationMembersService } from './organisation-members.service';
import { OrganisationMember } from './entities/organisation-member.entity';

describe('OrganisationMembersService', () => {
  let service: OrganisationMembersService;
  const mockRepository = {
    findOne: jest.fn(),
    save: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const moduleRef = await Test.createTestingModule({
      providers: [
        OrganisationMembersService,
        {
          provide: getRepositoryToken(OrganisationMember),
          useValue: mockRepository,
        },
      ],
    }).compile();

    service = moduleRef.get(OrganisationMembersService);
  });

  it('deactivates an organisation membership when it exists', async () => {
    const member = {
      id: 'member-1',
      organisationId: 'org-1',
      userId: 'user-1',
      isActive: true,
    };
    mockRepository.findOne.mockResolvedValue(member);
    mockRepository.save.mockImplementation(async (value) => value);

    const result = await service.setMembershipActive('org-1', 'user-1', false);

    expect(mockRepository.findOne).toHaveBeenCalledWith({
      where: { organisationId: 'org-1', userId: 'user-1' },
    });
    expect(mockRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        organisationId: 'org-1',
        userId: 'user-1',
        isActive: false,
      }),
    );
    expect(result.isActive).toBe(false);
  });

  it('supports deactivating by membership id as well as user id', async () => {
    const member = {
      id: 'member-2',
      organisationId: 'org-1',
      userId: 'user-2',
      isActive: true,
    };
    mockRepository.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(member);
    mockRepository.save.mockImplementation(async (value) => value);

    const result = await service.setMembershipActive('org-1', 'member-2', false);

    expect(mockRepository.findOne).toHaveBeenNthCalledWith(1, {
      where: { organisationId: 'org-1', userId: 'member-2' },
    });
    expect(mockRepository.findOne).toHaveBeenNthCalledWith(2, {
      where: { organisationId: 'org-1', id: 'member-2' },
    });
    expect(result.isActive).toBe(false);
  });

  it('throws when the membership cannot be found', async () => {
    mockRepository.findOne.mockResolvedValue(null);

    await expect(
      service.setMembershipActive('org-1', 'missing-user', false),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
