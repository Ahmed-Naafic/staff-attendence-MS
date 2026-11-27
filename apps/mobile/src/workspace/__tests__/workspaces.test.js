import { branchList, chooseBranch, chooseWorkspace, inBranch, workspacesFor } from '../workspaces';
import { subjectGroups } from '../../screens/lessons/MySubjectsScreen';
import { waitingText } from '../../components/AppHeader';

test('workspaces come only from the account role and Fee Management access', () => {
  expect(workspacesFor({ role: 'STAFF' })).toEqual(['teacher']);
  expect(workspacesFor({ role: 'STAFF', feeAccess: true })).toEqual(['teacher', 'accountant']);
  expect(workspacesFor({ role: 'MANAGER', feeAccess: true })).toEqual(['manager']);
  expect(workspacesFor({ role: 'ACCOUNTANT' })).toEqual(['accountant']);
  expect(workspacesFor({ role: 'OWNER' })).toEqual([]);
  expect(workspacesFor(null)).toEqual([]);
});

test('the remembered workspace is kept only while it is still allowed', () => {
  expect(chooseWorkspace(['teacher', 'accountant'], 'accountant')).toBe('accountant');
  // Fee Management access was removed: back to the first allowed workspace.
  expect(chooseWorkspace(['teacher'], 'accountant')).toBe('teacher');
  expect(chooseWorkspace([], 'teacher')).toBeNull();
});

test('branches: home first, no duplicates; the remembered one only while still allowed', () => {
  const list = branchList({ id: 'b1', name: 'Main' }, [{ id: 'b2', name: 'North' }, { id: 'b1', name: 'Main' }, null]);
  expect(list).toEqual([
    { id: 'b1', code: null, name: 'Main', home: true },
    { id: 'b2', code: null, name: 'North', home: false },
  ]);
  expect(chooseBranch(list, 'b2')).toBe('b2');
  expect(chooseBranch(list, 'gone')).toBe('b1');
  expect(chooseBranch([], 'b1')).toBeNull();
  expect(inBranch({ section: { branch: { id: 'b2' } } }, 'b2')).toBe(true);
  expect(inBranch({ branch: { id: 'b1' } }, 'b2')).toBe(false);
  expect(inBranch({}, 'b2')).toBe(true);
});

test('My Subjects groups subject assignments by subject with their classes', () => {
  const items = [
    { role: 'class', section: { displayName: 'Grade 7A' } },
    { role: 'subject', subject: { id: 's1', name: 'Maths' }, section: { displayName: 'Grade 8A' } },
    { role: 'subject', subject: { id: 's1', name: 'Maths' }, section: { displayName: 'Grade 7A' } },
    { role: 'subject', subject: { id: 's2', name: 'Biology' }, section: { displayName: 'Grade 7A' } },
  ];
  expect(subjectGroups(items)).toEqual([
    { key: 's2', name: 'Biology', classes: ['Grade 7A'] },
    { key: 's1', name: 'Maths', classes: ['Grade 7A', 'Grade 8A'] },
  ]);
});

test('the switch warning names waiting records by kind', () => {
  expect(waitingText({ events: 0, marks: 0 })).toBe('');
  expect(waitingText({ events: 1, marks: 3 })).toBe('1 attendance event and 3 lesson marks');
});
