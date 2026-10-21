'use client';

import { DropdownSelect } from '@/components/ui/dropdown-select';

import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Copy, KeyRound, Pencil, Plus, ShieldCheck, UserRound, Users } from 'lucide-react';
import { api, peekApiCache, practicePath } from '@/lib/api';
import { usePractice } from '@/lib/practice-context';
import type { Branch, StaffMember } from '@/lib/types';
import { Dialog } from '@/components/dialog';
import { EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/app-shell';
import { Pagination, usePaginatedItems } from '@/components/ui/pagination';
import { POPULAR_PROFESSIONS, professionCodeFor } from '@/lib/popular-professions';

type Permission = { code: string; description: string; sensitive: boolean };
type Override = { permissionCode: string; locationId: string | null; effect: 'allow' | 'deny' };
type EditableRole = 'admin' | 'professional' | 'scheduler';
type RolePolicy = { permissions: Permission[]; defaults: Array<{ role: string; permissionCode: string; scope: 'practice' | 'assigned_locations' | 'own' }>; settings: Array<{ role: string; permissionCode: string; enabled: boolean; scope: 'practice' | 'assigned_locations' | 'own' }>; editableRoles: EditableRole[] };
type RoleDraft = Record<string, { enabled: boolean; scope: 'practice' | 'assigned_locations' | 'own' }>;
const roleOptions = [{ value: 'professional', label: 'Practitioner' }, { value: 'scheduler', label: 'Scheduler' }, { value: 'admin', label: 'Administrator' }] as const;
function createRoleDraft(policy: RolePolicy, role: EditableRole): RoleDraft {
  return Object.fromEntries(policy.permissions.map((permission) => {
    const setting = policy.settings.find((item) => item.role === role && item.permissionCode === permission.code);
    const defaultGrant = policy.defaults.find((item) => item.role === role && item.permissionCode === permission.code);
    return [permission.code, { enabled: setting?.enabled ?? Boolean(defaultGrant), scope: setting?.scope ?? defaultGrant?.scope ?? 'own' }];
  }));
}

export default function StaffPage() {
  const { practice, branchId, branches, professions, permissions, session, refreshProfessions } = usePractice();
  const teamUrl = practicePath(practice.id, branchId ? `/staff?locationId=${encodeURIComponent(branchId)}` : '/staff');
  const [data, setData] = useState<StaffMember[]>(() => peekApiCache<StaffMember[]>(teamUrl) ?? []); const [loading, setLoading] = useState(() => peekApiCache<StaffMember[]>(teamUrl) === null); const [error, setError] = useState('');
  const [inviteOpen, setInviteOpen] = useState(false); const [email, setEmail] = useState(''); const [roles, setRoles] = useState<string[]>(['professional']); const [locations, setLocations] = useState<string[]>(branchId ? [branchId] : []); const [inviteLink, setInviteLink] = useState(''); const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  const [editMember, setEditMember] = useState<StaffMember | null>(null); const [editRoles, setEditRoles] = useState<string[]>([]); const [editLocations, setEditLocations] = useState<string[]>([]);
  const [profileProfessionId, setProfileProfessionId] = useState(''); const [profileHeadline, setProfileHeadline] = useState(''); const [profileBio, setProfileBio] = useState('');
  const [professionQuickAddOpen, setProfessionQuickAddOpen] = useState(false); const [newProfessionName, setNewProfessionName] = useState(''); const [professionBusy, setProfessionBusy] = useState(false);
  const [professionMessageIsStatus, setProfessionMessageIsStatus] = useState(false);
  const [accessMember, setAccessMember] = useState<StaffMember | null>(null); const [catalog, setCatalog] = useState<Permission[]>([]); const [overrides, setOverrides] = useState<Override[]>([]); const [accessScope, setAccessScope] = useState('');
  const [rolePermissionOpen, setRolePermissionOpen] = useState(false); const [rolePolicy, setRolePolicy] = useState<RolePolicy | null>(null); const [rolePermissionRole, setRolePermissionRole] = useState<EditableRole>('professional'); const [roleDraft, setRoleDraft] = useState<RoleDraft>({}); const [rolePermissionBusy, setRolePermissionBusy] = useState(false); const [rolePermissionMessage, setRolePermissionMessage] = useState('');
  const pagination = usePaginatedItems(data);
  const isOwner = session.practices.find((item) => item.practiceId === practice.id)?.roles.includes('owner') ?? false;
  const load = useCallback(async () => { if (peekApiCache<StaffMember[]>(teamUrl) === null) setLoading(true); setError(''); try { setData(await api<StaffMember[]>(teamUrl)); } catch (e) { setError(e instanceof Error ? e.message : 'Could not load the practice team.'); } finally { setLoading(false); } }, [teamUrl]);
  useEffect(() => { void load(); }, [load]);
  function openInvite() { setEmail(''); setRoles(['professional']); setLocations(branchId ? [branchId] : []); setInviteLink(''); setMessage(''); setInviteOpen(true); }
  function toggleRole(role: string) { setRoles((items) => items.includes(role) ? items.filter((item) => item !== role) : [...items, role]); }
  function toggleLocation(id: string) { setLocations((items) => items.includes(id) ? items.filter((item) => item !== id) : [...items, id]); }
  async function invite(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setMessage(''); if (roles.includes('professional') && locations.length === 0) { setMessage('Choose at least one branch for a practitioner.'); return; } setBusy(true); try { const result = await api<{ acceptanceUrl: string }>(practicePath(practice.id, '/staff/invitations'), { method: 'POST', body: JSON.stringify({ email, roles, locationIds: locations }) }); setInviteLink(result.acceptanceUrl); setMessage('Invite created. Share this secure link with your teammate.'); } catch (e) { setMessage(e instanceof Error ? e.message : 'Could not create this invitation.'); } finally { setBusy(false); } }
  function edit(member: StaffMember) {
    const profile = member.professionalProfiles?.[0];
    const isOwnOwner = member.userId === session.user.id && member.roles.includes('owner');
    setEditMember(member);
    setEditRoles(isOwnOwner ? [...new Set([...member.roles.filter((role) => role !== 'owner'), 'professional'])] : member.roles.filter((role) => role !== 'owner'));
    setEditLocations(member.locations.map((item) => item.id));
    setProfileProfessionId(profile?.professionId ?? professions[0]?.id ?? '');
    setProfileHeadline(profile?.headline ?? ''); setProfileBio(profile?.bio ?? ''); setMessage(''); setProfessionMessageIsStatus(false); setProfessionQuickAddOpen(false); setNewProfessionName('');
  }
  async function addProfession(nameToAdd = newProfessionName) {
    const name = nameToAdd.trim();
    const professionCode = professionCodeFor(name);
    if (name.length < 2 || professionCode.length < 2) { setProfessionMessageIsStatus(false); setMessage('Enter a profession name using at least two letters or numbers.'); return; }
    const existing = professions.find((profession) => profession.name.trim().toLowerCase() === name.toLowerCase());
    if (existing) {
      setProfileProfessionId(existing.id); setProfessionQuickAddOpen(false); setNewProfessionName('');
      setProfessionMessageIsStatus(true); setMessage(`“${existing.name}” is already in this practice and has been selected.`);
      return;
    }
    setProfessionBusy(true); setMessage(''); setProfessionMessageIsStatus(false);
    try {
      const created = await api<{ id: string }>(practicePath(practice.id, '/professions'), { method: 'POST', body: JSON.stringify({ professionCode, name, termOverrides: {} }) });
      await refreshProfessions();
      setProfileProfessionId(created.id); setProfessionQuickAddOpen(false); setNewProfessionName('');
      setProfessionMessageIsStatus(true); setMessage(`“${name}” added and selected. Save the profile to assign it to this practitioner.`);
    } catch (e) { setProfessionMessageIsStatus(false); setMessage(e instanceof Error ? e.message : 'Could not add this profession.'); }
    finally { setProfessionBusy(false); }
  }
  async function saveMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!editMember) return; setBusy(true); setMessage(''); setProfessionMessageIsStatus(false);
    try {
      const isOwnOwner = editMember.userId === session.user.id && editMember.roles.includes('owner');
      if (!isOwnOwner) {
        await api(practicePath(practice.id, `/staff/${editMember.userId}/roles`), { method: 'PATCH', body: JSON.stringify({ roles: editRoles }) });
        await api(practicePath(practice.id, `/staff/${editMember.userId}/locations`), { method: 'PATCH', body: JSON.stringify({ locationIds: editLocations }) });
      }
      if (editRoles.includes('professional')) {
        const currentProfile = editMember.professionalProfiles?.find((profile) => profile.professionId === profileProfessionId);
        await api(practicePath(practice.id, `/staff/${editMember.userId}/professional-profile`), { method: 'POST', body: JSON.stringify({ practiceProfessionId: profileProfessionId, headline: profileHeadline || null, bio: profileBio || null, profileAttributes: currentProfile?.profileAttributes ?? {}, publicProfile: true, locationIds: editLocations.length ? editLocations : branchId ? [branchId] : branches.map((branch) => branch.id) }) });
      }
      setEditMember(null); await load();
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Could not update team access.'); }
    finally { setBusy(false); }
  }
  async function openAccess(member: StaffMember) { setAccessMember(member); setAccessScope(branchId || ''); setMessage(''); setBusy(true); try { const [permissions, current] = await Promise.all([api<Permission[]>(practicePath(practice.id, '/permissions')), api<Override[]>(practicePath(practice.id, `/staff/${member.userId}/permissions`))]); setCatalog(permissions); setOverrides(current); } catch (e) { setMessage(e instanceof Error ? e.message : 'Could not load permissions.'); } finally { setBusy(false); } }
  function permissionEffect(code: string) { return overrides.find((item) => item.permissionCode === code && item.locationId === (accessScope || null))?.effect ?? 'inherit'; }
  function setPermission(code: string, value: string) { setOverrides((items) => [...items.filter((item) => !(item.permissionCode === code && item.locationId === (accessScope || null))), ...(value === 'inherit' ? [] : [{ permissionCode: code, locationId: accessScope || null, effect: value as 'allow' | 'deny' }])]); }
  async function savePermissions(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (!accessMember) return; setBusy(true); setMessage(''); try { await api(practicePath(practice.id, `/staff/${accessMember.userId}/permissions`), { method: 'PUT', body: JSON.stringify({ overrides }) }); setAccessMember(null); } catch (e) { setMessage(e instanceof Error ? e.message : 'Could not save permissions.'); } finally { setBusy(false); } }
  async function fetchRolePolicy() { return api<RolePolicy>(practicePath(practice.id, '/role-permissions')); }
  async function openRolePermissions() {
    setRolePermissionBusy(true); setRolePermissionMessage('');
    try { const policy = await fetchRolePolicy(); setRolePolicy(policy); setRolePermissionRole('professional'); setRoleDraft(createRoleDraft(policy, 'professional')); setRolePermissionOpen(true); }
    catch (e) { setRolePermissionMessage(e instanceof Error ? e.message : 'Could not load role permissions.'); }
    finally { setRolePermissionBusy(false); }
  }
  async function saveRolePermissions(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!rolePolicy) return; setRolePermissionBusy(true); setRolePermissionMessage('');
    try {
      await api(practicePath(practice.id, `/role-permissions/${rolePermissionRole}`), { method: 'PUT', body: JSON.stringify({ settings: rolePolicy.permissions.map((permission) => ({ permissionCode: permission.code, ...roleDraft[permission.code] })) }) });
      const policy = await fetchRolePolicy(); setRolePolicy(policy); setRoleDraft(createRoleDraft(policy, rolePermissionRole)); setRolePermissionMessage(`${roleOptions.find((item) => item.value === rolePermissionRole)?.label} permissions saved for this practice.`);
    } catch (e) { setRolePermissionMessage(e instanceof Error ? e.message : 'Could not save role permissions.'); }
    finally { setRolePermissionBusy(false); }
  }
  async function resetRolePermissions() {
    if (!rolePolicy) return; setRolePermissionBusy(true); setRolePermissionMessage('');
    try {
      await api(practicePath(practice.id, `/role-permissions/${rolePermissionRole}`), { method: 'PUT', body: JSON.stringify({ resetToDefaults: true, settings: [] }) });
      const policy = await fetchRolePolicy(); setRolePolicy(policy); setRoleDraft(createRoleDraft(policy, rolePermissionRole)); setRolePermissionMessage('This role now uses the system default permissions.');
    } catch (e) { setRolePermissionMessage(e instanceof Error ? e.message : 'Could not reset role permissions.'); }
    finally { setRolePermissionBusy(false); }
  }
  return <><PageHeader eyebrow="PEOPLE & ACCESS" title="Team" description="Invite practitioners and staff, assign their branches, and tune permissions to fit their responsibilities." action={permissions['staff.manage'] ? <div className="inline-actions">{isOwner && <button className="button button-secondary" onClick={() => void openRolePermissions()}><ShieldCheck size={15}/> Role permissions</button>}<button className="button button-primary" onClick={openInvite}><Plus size={16}/> Invite teammate</button></div> : undefined}/>
    {loading ? <section className="section-card resource-card"><LoadingState/></section> : error ? <section className="section-card resource-card"><ErrorState message={error}/></section> : !data.length ? <section className="section-card resource-card"><EmptyState title="Build your practice team" description="Invite a teammate, choose their role and branch access, then adjust their permissions as needed." icon={Users}/></section> : <section className="section-card resource-card"><div className="table-wrap"><table><thead><tr><th>Team member</th><th>Role</th><th>Branch access</th><th>Status</th><th>Manage</th></tr></thead><tbody>{pagination.pageItems.map((member) => <tr key={member.membershipId}><td data-label="Team member"><span className="person-cell"><span className="avatar">{member.fullName.slice(0, 1).toUpperCase()}</span><span><strong>{member.fullName}</strong><small>{member.email}</small></span></span></td><td data-label="Role"><div className="tag-list">{member.roles.map((role) => <span className="soft-tag" key={role}>{role === 'professional' ? 'Practitioner' : role}</span>)}</div></td><td data-label="Branch access">{member.locations.length ? member.locations.map((branch) => branch.name).join(', ') : 'All branches'}</td><td data-label="Status"><span className="member-status"><UserRound size={14}/>{member.status}</span></td><td data-label="Manage"><div className="inline-actions">{isOwner && member.userId === session.user.id && member.roles.includes('owner') && <button className="button button-secondary compact-button" onClick={() => edit(member)}><Pencil size={13}/> Edit my profession</button>}{permissions['staff.manage'] && !member.roles.includes('owner') && <><button className="button button-secondary compact-button" onClick={() => edit(member)}><Pencil size={13}/>{member.userId === session.user.id && member.roles.includes('admin') ? 'Edit my profession' : 'Edit'}</button>{isOwner && <button className="button button-secondary compact-button" onClick={() => void openAccess(member)}><KeyRound size={13}/> Permissions</button>}</>}</div></td></tr>)}</tbody></table></div><Pagination total={data.length} {...pagination} onPageChange={pagination.setPage} onPageSizeChange={pagination.setPageSize}/><p className="table-footnote">Role permissions are the defaults. Owners can grant or deny individual permissions for a person and branch.</p></section>}
    <Dialog open={inviteOpen} title="Invite a teammate" description="Start with the role and one branch. You can finish a practitioner profession, profile, and availability after they accept." onClose={() => setInviteOpen(false)}><form className="dialog-form" onSubmit={invite}><label>Work email<input required type="email" maxLength={320} value={email} onChange={(e) => setEmail(e.target.value)}/></label><fieldset className="choice-fieldset"><legend>Responsibilities</legend>{roleOptions.filter((role) => role.value !== 'admin' || isOwner).map((role) => <label className="check-row" key={role.value}><input type="checkbox" checked={roles.includes(role.value)} onChange={() => toggleRole(role.value)}/>{role.label}</label>)}</fieldset><fieldset className="choice-fieldset"><legend>Branch access <small>{roles.includes('professional') ? 'Choose at least one branch' : 'Optional for other roles'}</small></legend>{branches.map((branch) => <label className="check-row" key={branch.id}><input type="checkbox" checked={locations.includes(branch.id)} onChange={() => toggleLocation(branch.id)}/>{branch.name}</label>)}</fieldset>{roles.includes("professional") && !branches.length && <p className="field-hint">Add a branch before inviting a practitioner. <a className="text-link" href="/branches">Add a branch</a></p>}{message && <p className={inviteLink ? 'form-hint' : 'form-error'} role={inviteLink ? 'status' : 'alert'}>{message}</p>}{inviteLink && <div className="invite-link-box"><code>{inviteLink}</code><button type="button" className="button button-secondary" onClick={() => void navigator.clipboard.writeText(inviteLink)}><Copy size={14}/> Copy link</button></div>}<footer className="dialog-actions"><button type="button" className="button button-secondary" onClick={() => setInviteOpen(false)}>Close</button><button className="button button-primary" disabled={busy || roles.length === 0 || (roles.includes('professional') && locations.length === 0)}>{busy ? 'Creating…' : inviteLink ? 'Create another invite' : roles.includes('professional') ? 'Invite practitioner' : 'Create invite'}</button></footer></form></Dialog>
    <Dialog open={Boolean(editMember)} title={editMember?.userId === session.user.id && editMember.roles.includes('owner') ? 'Edit my profession' : editMember?.userId === session.user.id && editMember.roles.includes('admin') ? 'Edit my professional profile' : `Edit ${editMember?.fullName ?? 'team member'}`} description={editMember?.userId === session.user.id && editMember.roles.includes('owner') ? 'Choose the profession and branches attached to your own practitioner profile. Your owner access stays unchanged.' : 'Set the team member’s role, professional profile, and branch access.'} onClose={() => setEditMember(null)}><form className="dialog-form" onSubmit={saveMember}>{!(editMember?.userId === session.user.id && editMember.roles.includes('owner')) && <fieldset className="choice-fieldset"><legend>Responsibilities</legend>{roleOptions.filter((role) => role.value !== 'admin' || isOwner).map((role) => <label className="check-row" key={role.value}><input type="checkbox" checked={editRoles.includes(role.value)} onChange={() => setEditRoles((items) => items.includes(role.value) ? items.filter((item) => item !== role.value) : [...items, role.value])}/>{role.label}</label>)}{editMember?.userId === session.user.id && editMember.roles.includes('admin') && <small className="field-hint">To provide bookable services, keep Administrator selected and also enable Practitioner, then choose your profession below.</small>}</fieldset>}{(editRoles.includes('professional') || (editMember?.userId === session.user.id && editMember.roles.includes('owner'))) && <fieldset className="choice-fieldset"><legend>Professional profile</legend><div className="profession-field"><div className="profession-select-field"><span>Profession</span><DropdownSelect required value={profileProfessionId} onChange={(e) => setProfileProfessionId(e.target.value)}><option value="">Select a profession</option>{professions.map((profession) => <option key={profession.id} value={profession.id}>{profession.name}</option>)}</DropdownSelect></div>{(permissions['practice.update'] || permissions['services.manage']) && <button type="button" className="button button-secondary profession-add-trigger" aria-expanded={professionQuickAddOpen} onClick={() => { setProfessionQuickAddOpen((value) => !value); setMessage(''); }}>{professionQuickAddOpen ? 'Close quick add' : <><Plus size={14}/> Add profession</>}</button>}</div>{professionQuickAddOpen && <div className="profession-quick-add"><div><strong>Popular professions</strong><p>Choose one for this practice, or enter a custom profession.</p></div><div className="profession-suggestions">{POPULAR_PROFESSIONS.filter((name) => !professions.some((profession) => profession.name.trim().toLowerCase() === name.toLowerCase())).map((name) => <button type="button" className="profession-suggestion" key={name} disabled={professionBusy} onClick={() => void addProfession(name)}>{professionBusy ? 'Adding…' : <><Plus size={13}/>{name}</>}</button>)}</div><div className="profession-custom-add"><input aria-label="Custom profession name" maxLength={120} placeholder="Add another profession…" value={newProfessionName} onChange={(event) => setNewProfessionName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void addProfession(); } }}/><button type="button" className="button button-primary compact-button" disabled={professionBusy || !newProfessionName.trim()} onClick={() => void addProfession()}>{professionBusy ? 'Adding…' : 'Add custom'}</button></div></div>}{!(permissions['practice.update'] || permissions['services.manage']) && <small className="field-hint">Ask a practice owner or service manager to add a profession to this practice.</small>}<label>Public title<input maxLength={160} placeholder="e.g. Senior consultant" value={profileHeadline} onChange={(e) => setProfileHeadline(e.target.value)}/></label><label>Short introduction<textarea rows={3} maxLength={4000} value={profileBio} onChange={(e) => setProfileBio(e.target.value)}/></label></fieldset>}{!(editMember?.userId === session.user.id && editMember.roles.includes('owner')) && <fieldset className="choice-fieldset"><legend>Branch access <small>{editRoles.includes('professional') ? 'Choose at least one branch' : 'Optional for other roles'}</small></legend>{branches.map((branch) => <label className="check-row" key={branch.id}><input type="checkbox" checked={editLocations.includes(branch.id)} onChange={() => setEditLocations((items) => items.includes(branch.id) ? items.filter((id) => id !== branch.id) : [...items, branch.id])}/>{branch.name}</label>)}</fieldset>}{message && <p className={professionMessageIsStatus ? 'form-hint' : 'form-error'} role={professionMessageIsStatus ? 'status' : 'alert'}>{message}</p>}<footer className="dialog-actions"><button type="button" className="button button-secondary" onClick={() => setEditMember(null)}>Cancel</button><button className="button button-primary" disabled={busy || !editRoles.length || !profileProfessionId || (editRoles.includes('professional') && !(editLocations.length || (editMember?.userId === session.user.id && branchId)))}>{busy ? 'Saving…' : editMember?.userId === session.user.id && editMember.roles.includes('owner') ? 'Save profession' : 'Save access'}</button></footer></form></Dialog>
    <Dialog open={rolePermissionOpen} title="Role permissions" description="Set practice-wide defaults for each hired staff role. Individual permissions below can still override these defaults." onClose={() => setRolePermissionOpen(false)}>
      {rolePolicy && <form className="dialog-form" onSubmit={saveRolePermissions}>
        <label>Staff role<DropdownSelect value={rolePermissionRole} onChange={(event) => { const nextRole = event.target.value as EditableRole; setRolePermissionRole(nextRole); setRoleDraft(createRoleDraft(rolePolicy, nextRole)); setRolePermissionMessage(''); }}>
          {rolePolicy.editableRoles.map((role) => <option key={role} value={role}>{roleOptions.find((item) => item.value === role)?.label ?? role}</option>)}
        </DropdownSelect></label>
        <p className="field-hint">Changes apply to everyone with this role in this practice, unless they have an individual override.</p>
        <div className="permission-list role-permission-list">{rolePolicy.permissions.map((permission) => {
          const setting = roleDraft[permission.code] ?? { enabled: false, scope: 'own' as const };
          return <div className="permission-row role-permission-row" key={permission.code}>
            <span><strong>{permission.description}</strong><small>{permission.code}{permission.sensitive ? ' · sensitive' : ''}</small></span>
            <div className="role-permission-controls"><label className="role-permission-enabled"><input type="checkbox" checked={setting.enabled} onChange={(event) => setRoleDraft((current) => ({ ...current, [permission.code]: { ...setting, enabled: event.target.checked } }))}/> Allow</label>
              {setting.enabled && <DropdownSelect aria-label={`${permission.description} access scope`} value={setting.scope} onChange={(event) => setRoleDraft((current) => ({ ...current, [permission.code]: { ...setting, scope: event.target.value as typeof setting.scope } }))}><option value="own">Own records</option><option value="assigned_locations">Assigned branches</option><option value="practice">Entire practice</option></DropdownSelect>}
            </div>
          </div>;
        })}</div>
        {rolePermissionMessage && <p className="form-hint" role="status">{rolePermissionMessage}</p>}
        <footer className="dialog-actions role-permission-actions"><button type="button" className="button button-secondary" onClick={() => void resetRolePermissions()} disabled={rolePermissionBusy}>Reset to system defaults</button><button type="button" className="button button-secondary" onClick={() => setRolePermissionOpen(false)}>Close</button><button className="button button-primary" disabled={rolePermissionBusy}>{rolePermissionBusy ? 'Saving…' : 'Save role permissions'}</button></footer>
      </form>}
    </Dialog>
    <Dialog open={Boolean(accessMember)} title={`Permissions · ${accessMember?.fullName ?? ''}`} description="Use role defaults, or explicitly allow or deny permissions for this person at the practice or a selected branch." onClose={() => setAccessMember(null)}><form className="dialog-form" onSubmit={savePermissions}><label>Permission scope<DropdownSelect value={accessScope} onChange={(e) => setAccessScope(e.target.value)}><option value="">All branches · practice-wide</option>{branches.map((branch: Branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</DropdownSelect></label><div className="permission-list">{catalog.map((permission) => <label className="permission-row" key={permission.code}><span><strong>{permission.description}</strong><small>{permission.code}{permission.sensitive ? ' · sensitive' : ''}</small></span><DropdownSelect aria-label={`${permission.description} permission`} value={permissionEffect(permission.code)} onChange={(e) => setPermission(permission.code, e.target.value)}><option value="inherit">Use role</option><option value="allow">Allow</option><option value="deny">Deny</option></DropdownSelect></label>)}</div>{message && <p className="form-error" role="alert">{message}</p>}<footer className="dialog-actions"><button type="button" className="button button-secondary" onClick={() => setAccessMember(null)}>Cancel</button><button className="button button-primary" disabled={busy}>{busy ? 'Saving…' : 'Save permissions'}</button></footer></form></Dialog>
  </>;
}
