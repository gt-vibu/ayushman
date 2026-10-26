'use client';

import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Check, KeyRound, LockKeyhole, UserRound } from 'lucide-react';
import { api, practicePath } from '@/lib/api';
import { usePractice } from '@/lib/practice-context';
import type { StaffMember } from '@/lib/types';
import { PageHeader } from '@/components/app-shell';
import { DropdownSelect } from '@/components/ui/dropdown-select';

export default function ProfilePage() {
  const { session, practice, branches, professions, permissions, updatePractice, refreshProfessions } = usePractice();
  const [practiceName, setPracticeName] = useState(practice.name);
  const [practiceBusy, setPracticeBusy] = useState(false);
  const [practiceMessage, setPracticeMessage] = useState('');
  const [practiceError, setPracticeError] = useState('');
  const [member, setMember] = useState<StaffMember | null>(null);
  const [professionId, setProfessionId] = useState('');
  const [headline, setHeadline] = useState('');
  const [bio, setBio] = useState('');
  const [publicProfile, setPublicProfile] = useState(false);
  const [locationIds, setLocationIds] = useState<string[]>([]);
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileMessage, setProfileMessage] = useState('');
  const [profileError, setProfileError] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState('');
  const [passwordError, setPasswordError] = useState('');

  useEffect(() => {
    if (!permissions['staff.read']) return;
    let active = true;
    void api<StaffMember[]>(practicePath(practice.id, '/staff')).then((members) => {
      if (!active) return;
      const self = members.find((item) => item.userId === session.user.id);
      if (!self) return;
      setMember(self);
      const profile = self.professionalProfiles?.[0];
      setProfessionId(profile?.professionId ?? '');
      setHeadline(profile?.headline ?? '');
      setBio(profile?.bio ?? '');
      setPublicProfile(profile?.publicProfile ?? false);
      setLocationIds(profile?.locationIds ?? self.locations.map((location) => location.id));
    }).catch((error: unknown) => {
      if (active) setProfileError(error instanceof Error ? error.message : 'Could not load your professional profile.');
    });
    return () => { active = false; };
  }, [permissions, practice.id, session.user.id]);

  useEffect(() => setPracticeName(practice.name), [practice.name]);

  async function savePractice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPracticeBusy(true); setPracticeMessage(''); setPracticeError('');
    try {
      const updated = await api<Partial<typeof practice>>(practicePath(practice.id), { method: 'PATCH', body: JSON.stringify({ name: practiceName }) });
      updatePractice(updated); setPracticeMessage('Practice name saved.');
    } catch (error) { setPracticeError(error instanceof Error ? error.message : 'Could not update the practice name.'); }
    finally { setPracticeBusy(false); }
  }

  async function saveProfession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setProfileBusy(true); setProfileMessage(''); setProfileError('');
    try {
      await api(practicePath(practice.id, `/staff/${session.user.id}/professional-profile`), { method: 'POST', body: JSON.stringify({
        practiceProfessionId: professionId, headline: headline || null, bio: bio || null, publicProfile,
        profileAttributes: {}, locationIds,
      }) });
      await refreshProfessions();
      setProfileMessage('Professional profile saved.');
    } catch (error) { setProfileError(error instanceof Error ? error.message : 'Could not save your profession.'); }
    finally { setProfileBusy(false); }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPasswordMessage(''); setPasswordError('');
    if (newPassword !== confirmPassword) { setPasswordError('The new passwords do not match.'); return; }
    setPasswordBusy(true);
    try {
      await api('/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) });
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
      setPasswordMessage('Password changed. Other signed-in sessions have been signed out.');
    } catch (error) { setPasswordError(error instanceof Error ? error.message : 'Could not change your password.'); }
    finally { setPasswordBusy(false); }
  }

  const canEditProfession = permissions['staff.manage'] && (member?.roles.includes('professional') || member?.roles.includes('owner'));
  return <>
    <PageHeader eyebrow="ACCOUNT" title="Profile" description="Manage your account and sign-in security."/>
    {permissions['practice.update'] && <section className="section-card settings-card profile-section">
      <div className="section-heading"><div><p className="eyebrow">PRACTICE</p><h2><UserRound size={18}/> Practice profile</h2></div></div>
      <p className="page-description">This name is shown to customers when they discover and book your practice.</p>
      <form className="profile-form" onSubmit={savePractice}>
        <label>Practice name<input required minLength={2} maxLength={180} disabled={!permissions['practice.update']} value={practiceName} onChange={(event) => setPracticeName(event.target.value)}/></label>
        <div className="profile-form-actions">{practiceMessage && <span className="save-success"><Check size={15}/>{practiceMessage}</span>}{practiceError && <span className="form-error" role="alert">{practiceError}</span>}<button className="button button-primary" disabled={practiceBusy}>{practiceBusy ? 'Saving…' : 'Save practice name'}</button></div>
      </form>
    </section>}

    {canEditProfession && <section className="section-card settings-card profile-section">
      <div className="section-heading"><div><p className="eyebrow">PRACTITIONER</p><h2><UserRound size={18}/> Profession and profile</h2></div></div>
      <p className="page-description">Set the professional identity customers see when they choose a practitioner. Your practice access and permissions stay unchanged.</p>
      <form className="profile-form" onSubmit={saveProfession}>
        <label>Profession<DropdownSelect required value={professionId} onChange={(event) => setProfessionId(event.target.value)}><option value="">Select a profession</option>{professions.map((profession) => <option key={profession.id} value={profession.id}>{profession.name}</option>)}</DropdownSelect></label>
        <label>Public title<input maxLength={160} placeholder="e.g. Senior consultant" value={headline} onChange={(event) => setHeadline(event.target.value)}/></label>
        <label>Introduction<textarea rows={4} maxLength={4000} value={bio} onChange={(event) => setBio(event.target.value)}/></label>
        <fieldset className="choice-fieldset"><legend>Branches where you provide this profession</legend>{branches.map((branch) => <label className="check-row" key={branch.id}><input type="checkbox" checked={locationIds.includes(branch.id)} onChange={() => setLocationIds((current) => current.includes(branch.id) ? current.filter((id) => id !== branch.id) : [...current, branch.id])}/>{branch.name}</label>)}{!branches.length && <span className="field-hint">Add a branch before assigning a professional profile.</span>}</fieldset>
        <label className="check-row"><input type="checkbox" checked={publicProfile} onChange={(event) => setPublicProfile(event.target.checked)}/> Show my profile publicly</label>
        {profileMessage && <p className="form-hint" role="status">{profileMessage}</p>}{profileError && <p className="form-error" role="alert">{profileError}</p>}
        <div className="profile-form-actions"><button className="button button-primary" disabled={profileBusy || !professionId || !locationIds.length}>{profileBusy ? 'Saving…' : 'Save professional profile'}</button></div>
      </form>
    </section>}
    <section className="section-card settings-card profile-section">
      <div className="section-heading"><div><p className="eyebrow">SECURITY</p><h2><LockKeyhole size={18}/> Change password</h2></div></div>
      <p className="page-description">Use at least 12 characters. Changing your password signs out other active sessions.</p>
      <form className="profile-form" onSubmit={changePassword}>
        <label>Current password<input type="password" autoComplete="current-password" required maxLength={128} value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)}/></label>
        <label>New password<input type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={newPassword} onChange={(event) => setNewPassword(event.target.value)}/></label>
        <label>Confirm new password<input type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)}/></label>
        {passwordMessage && <p className="form-hint" role="status">{passwordMessage}</p>}{passwordError && <p className="form-error" role="alert">{passwordError}</p>}
        <div className="profile-form-actions"><button className="button button-primary" disabled={passwordBusy}>{passwordBusy ? 'Updating…' : <><KeyRound size={15}/> Update password</>}</button></div>
      </form>
    </section>
  </>;
}
