import { Body, Controller, Get, Param, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/session.guard.js';
import { SessionGuard } from '../auth/session.guard.js';
import {
  LocationInput, LocationProfessionInput, PracticeProfessionInput, PracticeProfessionUpdateInput, PracticeUpdateInput,
  LocationScopeQuery, LocationUpdateInput, MembershipStatusInput, ProfessionalProfileInput,
  ServiceInput, StaffAssignmentInput, StaffLocationsInput, StaffRolesInput,
  MembershipPermissionOverridesInput,
  type LocationInput as LocationPayload, type LocationProfessionInput as LocationProfessionPayload,
  type LocationScopeQuery as LocationScopePayload, type LocationUpdateInput as LocationUpdatePayload,
  type MembershipStatusInput as MembershipStatusPayload, type PracticeProfessionInput as ProfessionPayload,
  type PracticeProfessionUpdateInput as ProfessionUpdatePayload,
  type MembershipPermissionOverridesInput as PermissionOverridesPayload,
  type PracticeUpdateInput as PracticeUpdatePayload, type ProfessionalProfileInput as ProfilePayload,
  type ServiceInput as ServicePayload, type StaffAssignmentInput as StaffPayload,
  type StaffLocationsInput as StaffLocationsPayload, type StaffRolesInput as StaffRolesPayload,
} from '@ayushman-v2/contracts';
import { ZodValidationPipe } from '../zod-validation.pipe.js';
import { PracticeSetupService } from './practice-setup.service.js';

@Controller('practices/:practiceId')
@UseGuards(SessionGuard)
export class PracticeSetupController {
  constructor(private readonly setup: PracticeSetupService) {}

  @Get()
  getPractice(@Req() req: AuthenticatedRequest, @Param('practiceId') id: string) {
    return this.setup.getPractice(req.user.id, id);
  }

  @Get('me/permissions')
  getMyPermissions(@Req() req: AuthenticatedRequest, @Param('practiceId') id: string, @Query(new ZodValidationPipe(LocationScopeQuery)) query: LocationScopePayload) {
    return this.setup.getMyPermissions(req.user.id, id, query.locationId);
  }

  @Patch()
  updatePractice(@Req() req: AuthenticatedRequest, @Param('practiceId') id: string, @Body(new ZodValidationPipe(PracticeUpdateInput)) body: PracticeUpdatePayload) {
    return this.setup.updatePractice(req.user.id, id, body);
  }

  @Get('professions')
  listProfessions(@Req() req: AuthenticatedRequest, @Param('practiceId') id: string) {
    return this.setup.listProfessions(req.user.id, id);
  }

  @Post('professions')
  addProfession(@Req() req: AuthenticatedRequest, @Param('practiceId') id: string, @Body(new ZodValidationPipe(PracticeProfessionInput)) body: ProfessionPayload) {
    return this.setup.addProfession(req.user.id, id, body);
  }

  @Patch('professions/:professionId')
  updateProfession(@Req() req: AuthenticatedRequest, @Param('practiceId') id: string, @Param('professionId') professionId: string, @Body(new ZodValidationPipe(PracticeProfessionUpdateInput)) body: ProfessionUpdatePayload) {
    return this.setup.updateProfession(req.user.id, id, professionId, body);
  }

  @Get('locations')
  listLocations(@Req() req: AuthenticatedRequest, @Param('practiceId') id: string, @Query(new ZodValidationPipe(LocationScopeQuery)) query: LocationScopePayload) {
    return this.setup.listLocations(req.user.id, id, query.locationId);
  }

  @Post('locations')
  createLocation(@Req() req: AuthenticatedRequest, @Param('practiceId') id: string, @Body(new ZodValidationPipe(LocationInput)) body: LocationPayload) {
    return this.setup.createLocation(req.user.id, id, body);
  }

  @Patch('locations/:locationId')
  updateLocation(@Req() req: AuthenticatedRequest, @Param('practiceId') id: string, @Param('locationId') locationId: string, @Body(new ZodValidationPipe(LocationUpdateInput)) body: LocationUpdatePayload) {
    return this.setup.updateLocation(req.user.id, id, locationId, body);
  }

  @Post('locations/:locationId/professions')
  enableProfessionAtLocation(@Req() req: AuthenticatedRequest, @Param('practiceId') id: string, @Param('locationId') locationId: string, @Body(new ZodValidationPipe(LocationProfessionInput)) body: LocationProfessionPayload) {
    return this.setup.enableProfessionAtLocation(req.user.id, id, locationId, body);
  }

  @Post('staff')
  addStaff(@Req() req: AuthenticatedRequest, @Param('practiceId') id: string, @Body(new ZodValidationPipe(StaffAssignmentInput)) body: StaffPayload) {
    return this.setup.addStaff(req.user.id, id, body);
  }

  @Get('staff')
  listStaff(@Req() req: AuthenticatedRequest, @Param('practiceId') id: string, @Query(new ZodValidationPipe(LocationScopeQuery)) query: LocationScopePayload) {
    return this.setup.listStaff(req.user.id, id, query.locationId);
  }

  @Patch('staff/:userId/roles')
  updateStaffRoles(@Req() req: AuthenticatedRequest, @Param('practiceId') id: string, @Param('userId') userId: string, @Body(new ZodValidationPipe(StaffRolesInput)) body: StaffRolesPayload) {
    return this.setup.updateStaffRoles(req.user.id, id, userId, body);
  }

  @Patch('staff/:userId/locations')
  updateStaffLocations(@Req() req: AuthenticatedRequest, @Param('practiceId') id: string, @Param('userId') userId: string, @Body(new ZodValidationPipe(StaffLocationsInput)) body: StaffLocationsPayload) {
    return this.setup.updateStaffLocations(req.user.id, id, userId, body);
  }

  @Patch('staff/:userId/status')
  updateStaffStatus(@Req() req: AuthenticatedRequest, @Param('practiceId') id: string, @Param('userId') userId: string, @Body(new ZodValidationPipe(MembershipStatusInput)) body: MembershipStatusPayload) {
    return this.setup.updateStaffStatus(req.user.id, id, userId, body);
  }

  @Get('permissions')
  listPermissionCatalog(@Req() req: AuthenticatedRequest, @Param('practiceId') id: string) {
    return this.setup.listPermissionCatalog(req.user.id, id);
  }

  @Get('staff/:userId/permissions')
  listStaffPermissionOverrides(@Req() req: AuthenticatedRequest, @Param('practiceId') id: string, @Param('userId') userId: string) {
    return this.setup.listStaffPermissionOverrides(req.user.id, id, userId);
  }

  @Put('staff/:userId/permissions')
  replaceStaffPermissionOverrides(@Req() req: AuthenticatedRequest, @Param('practiceId') id: string, @Param('userId') userId: string, @Body(new ZodValidationPipe(MembershipPermissionOverridesInput)) body: PermissionOverridesPayload) {
    return this.setup.replaceStaffPermissionOverrides(req.user.id, id, userId, body);
  }

  @Post('staff/:userId/professional-profile')
  addProfessionalProfile(@Req() req: AuthenticatedRequest, @Param('practiceId') id: string, @Param('userId') userId: string, @Body(new ZodValidationPipe(ProfessionalProfileInput)) body: ProfilePayload) {
    return this.setup.addProfessionalProfile(req.user.id, id, userId, body);
  }

  @Get('services')
  listServices(@Req() req: AuthenticatedRequest, @Param('practiceId') id: string, @Query(new ZodValidationPipe(LocationScopeQuery)) query: LocationScopePayload) {
    return this.setup.listServices(req.user.id, id, query.locationId);
  }

  @Post('services')
  createService(@Req() req: AuthenticatedRequest, @Param('practiceId') id: string, @Body(new ZodValidationPipe(ServiceInput)) body: ServicePayload) {
    return this.setup.createService(req.user.id, id, body);
  }

  @Patch('services/:serviceId')
  updateService(@Req() req: AuthenticatedRequest, @Param('practiceId') id: string, @Param('serviceId') serviceId: string, @Body(new ZodValidationPipe(ServiceInput)) body: ServicePayload) {
    return this.setup.updateService(req.user.id, id, serviceId, body);
  }
}
