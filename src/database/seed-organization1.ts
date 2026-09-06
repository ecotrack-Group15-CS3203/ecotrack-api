import 'dotenv/config';
import * as bcrypt from 'bcryptjs';
import dataSource from './data-source';

const ORG_NAME = 'organization1';
const ORG_ADMIN_EMAIL = 'orgadmin@organization1.dev';
const ORG_ADMIN_PASSWORD = 'changeme';
const VOLUNTEER_EMAIL = 'volunteer@organization1.dev';
const VOLUNTEER_PASSWORD = 'changeme';

const registerIncidentImages: Record<string, string[]> = {
  'Illegal dumping near Riverside Park': ['/uploads/incidents/riverside-dumping.svg'],
  'Polluted stream at Meadow Bridge': ['/uploads/incidents/polluted-stream.svg'],
  'Smoke from waste burning site': ['/uploads/incidents/smoke-burn-site.svg'],
  'Unclaimed litter report near Greenway': ['/uploads/incidents/greenway-litter.svg'],
  'Unclaimed oil spill near Canal Road': ['/uploads/incidents/canal-oil-spill.svg'],
  'Unclaimed fly-tipping at North Fields': ['/uploads/incidents/north-fields-fly-tipping.svg'],
  'Recycling bins overturned at Market Square': ['/uploads/incidents/market-square-recycling.svg'],
  'Wildlife hazard at canal towpath': ['/uploads/incidents/towpath-wildlife.svg'],
  'Chemical containers beside allotments': ['/uploads/incidents/allotment-chemical.svg'],
  'Litter accumulation at bus depot': ['/uploads/incidents/bus-depot-litter.svg'],
  'Flooded drainage channel near South Docks': ['/uploads/incidents/south-docks-drainage.svg'],
  'Battery waste dumped beside allotments': ['/uploads/incidents/allotment-chemical.svg'],
  'Plastic rush along the riverside promenade': ['/uploads/incidents/riverside-dumping.svg'],
  'Overflowing bins at East Station Plaza': ['/uploads/incidents/market-square-recycling.svg'],
};

async function assignImagesToIncidentTitles(
  queryRunner: any,
  titles: string[],
): Promise<void> {
  for (const title of titles) {
    const [incident] = await queryRunner.query(
      `SELECT id FROM incidents WHERE title = $1 ORDER BY "createdAt" DESC LIMIT 1`,
      [title],
    );

    if (!incident) continue;

    for (const imageUrl of registerIncidentImages[title] ?? []) {
      await queryRunner.query(
        `INSERT INTO incident_images (incident_id, url)
         SELECT $1, $2::varchar
         WHERE NOT EXISTS (
           SELECT 1 FROM incident_images WHERE incident_id = $1 AND url = $2::varchar
         )`,
        [incident.id, imageUrl],
      );
    }
  }
}

async function main() {
  await dataSource.initialize();
  const queryRunner = dataSource.createQueryRunner();

  await queryRunner.connect();
  await queryRunner.startTransaction();

  try {
    const [admin] = await queryRunner.query(
      'SELECT id FROM users WHERE email = $1',
      [ORG_ADMIN_EMAIL],
    );
    const adminId =
      admin?.id ??
      (
        await queryRunner.query(
          `INSERT INTO users (full_name, email, password_hash)
           VALUES ($1, $2, $3)
           RETURNING id`,
          [
            'Organization 1 Admin',
            ORG_ADMIN_EMAIL,
            await bcrypt.hash(ORG_ADMIN_PASSWORD, 10),
          ],
        )
      )[0].id;

    const [volunteer] = await queryRunner.query(
      'SELECT id FROM users WHERE email = $1',
      [VOLUNTEER_EMAIL],
    );
    const volunteerId =
      volunteer?.id ??
      (
        await queryRunner.query(
          `INSERT INTO users (full_name, email, password_hash)
           VALUES ($1, $2, $3)
           RETURNING id`,
          [
            'Organization 1 Volunteer',
            VOLUNTEER_EMAIL,
            await bcrypt.hash(VOLUNTEER_PASSWORD, 10),
          ],
        )
      )[0].id;

    const applicantEmail = 'applicant@organization1.dev';
    const [applicant] = await queryRunner.query(
      'SELECT id FROM users WHERE email = $1',
      [applicantEmail],
    );
    const applicantId =
      applicant?.id ??
      (
        await queryRunner.query(
          `INSERT INTO users (full_name, email, password_hash)
           VALUES ($1, $2, $3)
           RETURNING id`,
          [
            'Organisation Applicant',
            applicantEmail,
            await bcrypt.hash('changeme', 10),
          ],
        )
      )[0].id;

    const [organisation] = await queryRunner.query(
      `SELECT id FROM organisations WHERE name = $1 ORDER BY "createdAt" LIMIT 1`,
      [ORG_NAME],
    );
    const organisationId =
      organisation?.id ??
      (
        await queryRunner.query(
          `INSERT INTO organisations (name, description)
           VALUES ($1, $2)
           RETURNING id`,
          [ORG_NAME, 'Demo organisation for local development'],
        )
      )[0].id;

    await queryRunner.query(
      `INSERT INTO organisation_members
         (organisation_id, user_id, role, is_active, joined_at)
       VALUES ($1, $2, 'org_admin', true, NOW())
       ON CONFLICT (organisation_id, user_id) DO UPDATE
       SET role = 'org_admin', is_active = true`,
      [organisationId, adminId],
    );
    await queryRunner.query(
      `INSERT INTO organisation_members
         (organisation_id, user_id, role, is_active, joined_at)
       VALUES ($1, $2, 'volunteer', true, NOW())
       ON CONFLICT (organisation_id, user_id) DO UPDATE
       SET role = 'volunteer', is_active = true`,
      [organisationId, volunteerId],
    );

    let [stage] = await queryRunner.query(
      `SELECT id FROM workflow_stages
       WHERE organisation_id = $1 ORDER BY position LIMIT 1`,
      [organisationId],
    );
    if (!stage) {
      const defaultStages = [
        'Reported',
        'Under Review',
        'Verified',
        'Cleanup Scheduled',
        'In Progress',
        'Resolved',
      ];
      for (const [position, name] of defaultStages.entries()) {
        const [createdStage] = await queryRunner.query(
          `INSERT INTO workflow_stages (organisation_id, name, position, is_final)
           VALUES ($1, $2, $3, $4)
           RETURNING id`,
          [organisationId, name, position, position === defaultStages.length - 1],
        );
        if (position === 0) stage = createdStage;
      }
    }

    const [verifiedStage] = await queryRunner.query(
      `SELECT id FROM workflow_stages
       WHERE organisation_id = $1 AND name = 'Verified' LIMIT 1`,
      [organisationId],
    );
    const [resolvedStage] = await queryRunner.query(
      `SELECT id FROM workflow_stages
       WHERE organisation_id = $1 AND name = 'Resolved' LIMIT 1`,
      [organisationId],
    );

    const [incident] = await queryRunner.query(
      `SELECT id FROM incidents WHERE organisation_id = $1 AND title = $2 LIMIT 1`,
      [organisationId, 'Illegal dumping near Riverside Park'],
    );
    const incidentId =
      incident?.id ??
      (
        await queryRunner.query(
          `INSERT INTO incidents
             (organisation_id, reported_by_user_id, title, description,
              category, severity, latitude, longitude, address,
              verification_status, current_stage_id)
           VALUES ($1, $2, $3, $4, 'illegal_dumping', 'high', $5, $6, $7,
                   'pending', $8)
           RETURNING id`,
          [
            organisationId,
            volunteerId,
            'Illegal dumping near Riverside Park',
            'Several bags of mixed waste have been left beside the river path.',
            51.5074,
            -0.1278,
            'Riverside Park, London',
            stage.id,
          ],
        )
      )[0].id;

    await queryRunner.query(
      `INSERT INTO tasks
         (organisation_id, incident_id, description, priority, scheduled_at,
          status, created_by_user_id)
       SELECT $1, $2, $3, 'high', NOW() + INTERVAL '2 days', 'pending', $4
       WHERE NOT EXISTS (
         SELECT 1 FROM tasks WHERE incident_id = $2 AND description = $3
       )`,
      [
        organisationId,
        incidentId,
        'Collect and safely dispose of the dumped waste.',
        adminId,
      ],
    );

    const additionalIncidents = [
      {
        title: 'Polluted stream at Meadow Bridge',
        description: 'The stream has an oily surface and a strong chemical smell.',
        category: 'water_pollution',
        severity: 'critical',
        latitude: 51.5142,
        longitude: -0.0941,
        address: 'Meadow Bridge, London',
        status: 'approved',
        stageId: verifiedStage.id,
        reporterId: adminId,
      },
      {
        title: 'Community garden cleanup completed',
        description: 'A fallen tree and scattered waste were cleared from the garden.',
        category: 'other',
        severity: 'low',
        latitude: 51.501,
        longitude: -0.1416,
        address: 'Southbank Community Garden, London',
        status: 'approved',
        stageId: resolvedStage.id,
        reporterId: volunteerId,
      },
      {
        title: 'Tree damage along North Trail',
        description: 'Several young trees have been damaged beside the public footpath.',
        category: 'deforestation',
        severity: 'medium',
        latitude: 51.5231,
        longitude: -0.1124,
        address: 'North Trail, London',
        status: 'pending',
        stageId: stage.id,
        reporterId: volunteerId,
      },
      {
        title: 'Smoke from waste burning site',
        description: 'Heavy smoke is coming from an apparent waste-burning site near homes.',
        category: 'air_pollution',
        severity: 'high',
        latitude: 51.4892,
        longitude: -0.1027,
        address: 'East Wharf, London',
        status: 'approved',
        stageId: verifiedStage.id,
        reporterId: volunteerId,
      },
      {
        title: 'Wildlife hazard at canal towpath',
        description: 'Discarded fishing line and hooks are creating a hazard for local wildlife.',
        category: 'wildlife_hazard',
        severity: 'medium',
        latitude: 51.5355,
        longitude: -0.0768,
        address: 'Canal Towpath, London',
        status: 'pending',
        stageId: stage.id,
        reporterId: adminId,
      },
      {
        title: 'Recycling bins overturned at Market Square',
        description: 'Recycling bins were overturned and waste has spread across the square.',
        category: 'illegal_dumping',
        severity: 'low',
        latitude: 51.5088,
        longitude: -0.0879,
        address: 'Market Square, London',
        status: 'approved',
        stageId: verifiedStage.id,
        reporterId: volunteerId,
      },
      {
        title: 'Chemical containers beside allotments',
        description: 'Unlabelled chemical containers were found beside the allotment boundary.',
        category: 'other',
        severity: 'critical',
        latitude: 51.4779,
        longitude: -0.1212,
        address: 'South Allotments, London',
        status: 'approved',
        stageId: verifiedStage.id,
        reporterId: adminId,
      },
      {
        title: 'Litter accumulation at bus depot',
        description: 'Persistent litter has accumulated behind the bus depot and blocks drainage.',
        category: 'illegal_dumping',
        severity: 'medium',
        latitude: 51.544,
        longitude: -0.1321,
        address: 'West Bus Depot, London',
        status: 'pending',
        stageId: stage.id,
        reporterId: volunteerId,
      },
      {
        title: 'Flooded drainage channel near South Docks',
        description: 'Blocked drainage and plastic waste are causing standing water near the docks.',
        category: 'water_pollution',
        severity: 'high',
        latitude: 51.5024,
        longitude: -0.055,
        address: 'South Docks, London',
        status: 'approved',
        stageId: verifiedStage.id,
        reporterId: adminId,
      },
      {
        title: 'Battery waste dumped beside allotments',
        description: 'Used batteries and packaging were left near the allotment path.',
        category: 'other',
        severity: 'high',
        latitude: 51.4813,
        longitude: -0.1298,
        address: 'North Allotments, London',
        status: 'pending',
        stageId: stage.id,
        reporterId: volunteerId,
      },
      {
        title: 'Plastic rush along the riverside promenade',
        description: 'Plastic packaging and wrappers are gathering along the promenade after the recent rain.',
        category: 'illegal_dumping',
        severity: 'medium',
        latitude: 51.5017,
        longitude: -0.1333,
        address: 'Riverside Promenade, London',
        status: 'approved',
        stageId: verifiedStage.id,
        reporterId: volunteerId,
      },
      {
        title: 'Overflowing bins at East Station Plaza',
        description: 'Bins near the station are overflowing and attracting additional litter.',
        category: 'illegal_dumping',
        severity: 'low',
        latitude: 51.5189,
        longitude: -0.0784,
        address: 'East Station Plaza, London',
        status: 'pending',
        stageId: stage.id,
        reporterId: adminId,
      },
      {
        title: 'Wetland boardwalk cleanup completed',
        description: 'Plastic waste was removed from the wetland boardwalk during a volunteer event.',
        category: 'other',
        severity: 'low',
        latitude: 51.4627,
        longitude: -0.0584,
        address: 'East Wetlands, London',
        status: 'approved',
        stageId: resolvedStage.id,
        reporterId: volunteerId,
      },
    ];

    for (const incidentData of additionalIncidents) {
      const [existingIncident] = await queryRunner.query(
        `SELECT id FROM incidents WHERE organisation_id = $1 AND title = $2 LIMIT 1`,
        [organisationId, incidentData.title],
      );
      if (existingIncident) continue;

      const [createdIncident] = await queryRunner.query(
        `INSERT INTO incidents
           (organisation_id, reported_by_user_id, title, description,
            category, severity, latitude, longitude, address,
            verification_status, current_stage_id, verified_by_user_id, verified_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
         RETURNING id`,
        [
          organisationId,
          incidentData.reporterId,
          incidentData.title,
          incidentData.description,
          incidentData.category,
          incidentData.severity,
          incidentData.latitude,
          incidentData.longitude,
          incidentData.address,
          incidentData.status,
          incidentData.stageId,
          adminId,
        ],
      );

      await queryRunner.query(
        `INSERT INTO tasks
           (organisation_id, incident_id, description, priority, scheduled_at,
            status, created_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          organisationId,
          createdIncident.id,
          incidentData.title === 'Community garden cleanup completed'
            ? 'Review the completed cleanup and archive the task.'
            : 'Inspect the location, document the issue, and coordinate a response.',
          incidentData.severity === 'critical' ? 'high' : 'medium',
          incidentData.status === 'approved'
            ? new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
            : null,
          incidentData.stageId === resolvedStage.id ? 'completed' : 'in_progress',
          adminId,
        ],
      );
    }

    const incidentTitlesWithImages = [
      'Illegal dumping near Riverside Park',
      'Polluted stream at Meadow Bridge',
      'Community garden cleanup completed',
      'Tree damage along North Trail',
      'Smoke from waste burning site',
      'Wildlife hazard at canal towpath',
      'Recycling bins overturned at Market Square',
      'Chemical containers beside allotments',
      'Litter accumulation at bus depot',
      'Flooded drainage channel near South Docks',
      'Battery waste dumped beside allotments',
      'Plastic rush along the riverside promenade',
      'Overflowing bins at East Station Plaza',
      'Unclaimed litter report near Greenway',
      'Unclaimed oil spill near Canal Road',
      'Unclaimed fly-tipping at North Fields',
    ];
    await assignImagesToIncidentTitles(queryRunner, incidentTitlesWithImages);

    const [assignedTask] = await queryRunner.query(
      `SELECT id FROM tasks
       WHERE organisation_id = $1
         AND description = 'Inspect the location, document the issue, and coordinate a response.'
       ORDER BY "createdAt" LIMIT 1`,
      [organisationId],
    );
    if (assignedTask) {
      await queryRunner.query(
        `INSERT INTO task_assignments (task_id, volunteer_user_id, status)
         VALUES ($1, $2, 'assigned')
         ON CONFLICT (task_id, volunteer_user_id) DO NOTHING`,
        [assignedTask.id, volunteerId],
      );
      await queryRunner.query(
        `INSERT INTO notifications
           (user_id, organisation_id, type, title, message,
            related_entity_type, related_entity_id)
         SELECT $1, $2, 'task_assigned', $3, $4, 'task', $5
         WHERE NOT EXISTS (
           SELECT 1 FROM notifications
           WHERE user_id = $1 AND related_entity_id = $5 AND type = 'task_assigned'
         )`,
        [
          volunteerId,
          organisationId,
          'New cleanup task assigned',
          'You have been assigned a cleanup task in organization1.',
          assignedTask.id,
        ],
      );
    }

    const [approvedIncident] = await queryRunner.query(
      `SELECT id FROM incidents
       WHERE organisation_id = $1 AND title = 'Polluted stream at Meadow Bridge'
       LIMIT 1`,
      [organisationId],
    );
    if (approvedIncident) {
      await queryRunner.query(
        `UPDATE notifications
         SET related_entity_id = $1
         WHERE user_id = $2 AND organisation_id = $3
           AND type = 'incident_approved' AND title = 'Incident approved'`,
        [approvedIncident.id, adminId, organisationId],
      );
    }

    await queryRunner.query(
      `INSERT INTO notifications
         (user_id, organisation_id, type, title, message,
          related_entity_type, related_entity_id)
       SELECT $1, $2, 'incident_approved', $3, $4, 'incident', $5
       WHERE NOT EXISTS (
         SELECT 1 FROM notifications
         WHERE user_id = $1 AND related_entity_id = $5 AND type = 'incident_approved'
       )`,
      [
        adminId,
        organisationId,
        'Incident approved',
        'The polluted stream incident is ready for response.',
        approvedIncident?.id ?? incidentId,
      ],
    );

    await queryRunner.query(
      `INSERT INTO events
         (organisation_id, incident_ids, title, description, latitude, longitude,
          address, scheduled_at, ends_at, max_attendees, status, created_by_user_id)
       SELECT $1, ARRAY[$2]::uuid[], $3, $4, $5, $6, $7,
              NOW() + INTERVAL '7 days', NOW() + INTERVAL '7 days' + INTERVAL '3 hours',
              25, 'scheduled', $8
       WHERE NOT EXISTS (
         SELECT 1 FROM events WHERE organisation_id = $1 AND title = $3::varchar
       )`,
      [
        organisationId,
        approvedIncident?.id ?? incidentId,
        'Riverside Cleanup Day',
        'Community cleanup event to address the reported environmental incidents.',
        51.5142,
        -0.0941,
        'Meadow Bridge, London',
        adminId,
      ],
    );

    await queryRunner.query(
      `INSERT INTO incidents
         (organisation_id, reported_by_user_id, title, description,
          category, severity, latitude, longitude, address,
          verification_status, current_stage_id)
       SELECT NULL, $1, $2, $3, 'illegal_dumping', 'high', $4, $5, $6,
              'pending', NULL
       WHERE NOT EXISTS (
         SELECT 1 FROM incidents WHERE organisation_id IS NULL AND title = $2::varchar
       )`,
      [
        volunteerId,
        'Unclaimed litter report near Greenway',
        'A new environmental report is waiting for an organisation to claim it.',
        51.5201,
        -0.11,
        'Greenway, London',
      ],
    );

    const poolIncidentsToSeed = [
      {
        title: 'Unclaimed oil spill near Canal Road',
        description: 'An oil spill has been reported near the canal access road.',
        category: 'water_pollution',
        severity: 'critical',
        latitude: 51.526,
        longitude: -0.09,
        address: 'Canal Road, London',
      },
      {
        title: 'Unclaimed fly-tipping at North Fields',
        description: 'Household waste has been dumped beside the North Fields path.',
        category: 'illegal_dumping',
        severity: 'medium',
        latitude: 51.538,
        longitude: -0.12,
        address: 'North Fields, London',
      },
      {
        title: 'Unclaimed plastic wash-up at East Beach',
        description: 'Large amounts of plastic waste have washed ashore after storm activity.',
        category: 'water_pollution',
        severity: 'high',
        latitude: 51.4915,
        longitude: -0.0534,
        address: 'East Beach, London',
      },
      {
        title: 'Unclaimed dumping near Old Quarry Lane',
        description: 'A mixed waste pile has been left beside an old quarry access track.',
        category: 'illegal_dumping',
        severity: 'medium',
        latitude: 51.4822,
        longitude: -0.1468,
        address: 'Old Quarry Lane, London',
      },
      {
        title: 'Unclaimed chemical drums by Meadow Park',
        description: 'Several sealed drums were left near the edge of the park woodland path.',
        category: 'other',
        severity: 'critical',
        latitude: 51.5187,
        longitude: -0.1022,
        address: 'Meadow Park, London',
      },
      {
        title: 'Unclaimed smoke plume near Railway Cut',
        description: 'A visible smoke plume is rising from scattered waste near the rail cut.',
        category: 'air_pollution',
        severity: 'high',
        latitude: 51.5309,
        longitude: -0.0657,
        address: 'Railway Cut, London',
      },
    ];

    for (const poolIncident of poolIncidentsToSeed) {
      await queryRunner.query(
        `INSERT INTO incidents
           (organisation_id, reported_by_user_id, title, description,
            category, severity, latitude, longitude, address,
            verification_status, current_stage_id)
         SELECT NULL, $1, $2, $3, $4, $5, $6, $7, $8, 'pending', NULL
         WHERE NOT EXISTS (
           SELECT 1 FROM incidents WHERE organisation_id IS NULL AND title = $2::varchar
         )`,
        [
          volunteerId,
          poolIncident.title,
          poolIncident.description,
          poolIncident.category,
          poolIncident.severity,
          poolIncident.latitude,
          poolIncident.longitude,
          poolIncident.address,
        ],
      );
    }

    const poolIncidentTitles = poolIncidentsToSeed.map((incident) => incident.title);
    await assignImagesToIncidentTitles(queryRunner, [
      ...poolIncidentTitles,
      'Unclaimed litter report near Greenway',
    ]);

    const poolIncidents: Array<{ incident_code: string; title: string }> =
      await queryRunner.query(
      `SELECT incident_code, title FROM incidents
       WHERE organisation_id IS NULL ORDER BY "createdAt" DESC`,
      );

    await queryRunner.query(
      `INSERT INTO join_requests
         (organisation_id, requester_user_id, message, status)
       SELECT $1, $2, $3, 'pending'
       WHERE NOT EXISTS (
         SELECT 1 FROM join_requests
         WHERE organisation_id = $1 AND requester_user_id = $2 AND status = 'pending'
       )`,
      [
        organisationId,
        applicantId,
        'I would like to volunteer with this organisation.',
      ],
    );

    await queryRunner.commitTransaction();
    console.log(`Seeded ${ORG_NAME}.`);
    console.log(`Organisation admin: ${ORG_ADMIN_EMAIL} / ${ORG_ADMIN_PASSWORD}`);
    console.log(`Volunteer: ${VOLUNTEER_EMAIL} / ${VOLUNTEER_PASSWORD}`);
    console.log(
      `Incident pool: ${poolIncidents.map((incident) => `${incident.incident_code} (${incident.title})`).join(', ')}`,
    );
  } catch (error) {
    await queryRunner.rollbackTransaction();
    throw error;
  } finally {
    await queryRunner.release();
    await dataSource.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});