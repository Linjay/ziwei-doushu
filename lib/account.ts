export interface PersonalProfile {
  displayName: string;
  birthday: string;
  birthTime: string;
  gender: '' | 'male' | 'female';
  city: string;
  bio: string;
}
export interface AccountUser {
  id: string;
  username: string;
  createdAt: number;
  profile: PersonalProfile;
  isGuest?: boolean;
  usesInitialPassword?: boolean;
}

export interface RememberedAccount { id: string; username: string; displayName: string }

export const emptyProfile = (displayName = ''): PersonalProfile => ({
  displayName, birthday: '', birthTime: '', gender: '', city: '', bio: '',
});
export function beijingDate() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)!.value).join('-');
}
