import { useState, useMemo, useEffect, useRef } from 'react';
import { useTasksContext } from '../hooks/useTasks';
import { useModalFocus } from '../hooks/useModalFocus';
import { auth, db } from '../auth';
import { doc, updateDoc, deleteDoc, deleteField } from 'firebase/firestore';
import { GroupProject, GroupTask, GroupMember, TaskPriority, GroupTaskStatus, TaskStatus } from '../types';
import { getCourseColor, formatInTimeZone, formatVancouverDate, zonedTimeToUtc, TIMEZONE } from '../utils';
import { 
  Users, 
  Plus, 
  Copy, 
  Check, 
  CheckSquare, 
  Clock, 
  UserPlus, 
  LogOut, 
  Calendar, 
  PieChart, 
  FolderGit2, 
  CheckCircle2, 
  Circle,
  Trash2,
  Edit2,
  AlertCircle
} from 'lucide-react';

function groupFormError(error: { code?: string; message?: string }, action: string): string {
  if (/permission-denied/.test(error.code || '') || /permission/i.test(error.message || '')) {
    return `Could not ${action}. Check that you are signed in, have access to the group, and that the fields are valid, then try again.`;
  }
  if (/unavailable|network|deadline-exceeded/.test(`${error.code || ''} ${error.message || ''}`)) {
    return `Could not ${action}. Check your connection and try again.`;
  }
  return `Could not ${action}. Please try again.`;
}

export default function GroupsTab() {
  const { 
    groups, 
    activeGroupId, 
    setActiveGroupId, 
    groupTasks, 
    createGroup, 
    joinGroupByCode, 
    leaveGroup, 
    saveGroupTaskAction, 
    deleteGroupTaskAction,
    isDemoMode,
    showToast,
    courses
  } = useTasksContext();

  const [activeSubTab, setActiveSubTab] = useState<'tasks' | 'contributions'>('tasks');
  const [filterAssignee, setFilterAssignee] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [copiedCode, setCopiedCode] = useState(false);
  const inviteCodeRef = useRef<HTMLElement>(null);

  // Modals
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isJoinModalOpen, setIsJoinModalOpen] = useState(false);
  const [isEditGroupModalOpen, setIsEditGroupModalOpen] = useState(false);
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<GroupTask | null>(null);

  // Form states
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupCourse, setNewGroupCourse] = useState(courses[0]?.course_code || '');
  const [newGroupDesc, setNewGroupDesc] = useState('');
  const [newGroupTargetDate, setNewGroupTargetDate] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);
  const creatingGroupRef = useRef(false);

  // Edit Group Form states
  const [editGroupName, setEditGroupName] = useState('');
  const [editGroupCourse, setEditGroupCourse] = useState('');
  const [editGroupDesc, setEditGroupDesc] = useState('');
  const [editGroupTargetDate, setEditGroupTargetDate] = useState('');
  const [editGroupError, setEditGroupError] = useState<string | null>(null);
  const [isSubmittingEdit, setIsSubmittingEdit] = useState(false);

  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [joinError, setJoinError] = useState<string | null>(null);

  // Task form state
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDesc, setTaskDesc] = useState('');
  const [taskDue, setTaskDue] = useState('');
  const [taskPriority, setTaskPriority] = useState<TaskPriority>('Medium');
  const [taskStatus, setTaskStatus] = useState<TaskStatus | GroupTaskStatus>('Not Started');
  const [taskAssignee, setTaskAssignee] = useState('');
  const [taskEstHours, setTaskEstHours] = useState('2');
  const [subtasksList, setSubtasksList] = useState<{ id?: string; title: string; assigned_to?: string; done: boolean }[]>([]);
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('');
  const [taskSaveError, setTaskSaveError] = useState<string | null>(null);
  const [isSavingTask, setIsSavingTask] = useState(false);
  const savingTaskRef = useRef(false);
  const createModal = useModalFocus({
    isOpen: isCreateModalOpen,
    onClose: () => { setIsCreateModalOpen(false); setCreateError(null); }
  });
  const joinModal = useModalFocus({
    isOpen: isJoinModalOpen,
    onClose: () => { setIsJoinModalOpen(false); setJoinError(null); }
  });

  const editGroupModal = useModalFocus({
    isOpen: isEditGroupModalOpen,
    onClose: () => { setIsEditGroupModalOpen(false); setEditGroupError(null); }
  });
  const taskModal = useModalFocus({
    isOpen: isTaskModalOpen,
    onClose: () => setIsTaskModalOpen(false)
  });

  // Local fallback storage to guarantee immediate UI updates for created/edited groups
  const [localExtraGroups, setLocalExtraGroups] = useState<GroupProject[]>(() => {
    try {
      const saved = localStorage.getItem('ubc_local_extra_groups');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    try {
      if (localExtraGroups.length > 0) {
        localStorage.setItem('ubc_local_extra_groups', JSON.stringify(localExtraGroups));
      } else {
        localStorage.removeItem('ubc_local_extra_groups');
      }
    } catch (e) {
      console.warn('Failed to save local extra groups to localStorage', e);
    }
  }, [localExtraGroups]);

  // Combined groups list ensuring locally created or edited groups are immediately visible
  const allGroups = useMemo(() => {
    const map = new Map<string, GroupProject>();
    groups.forEach(g => map.set(g.id, g));
    localExtraGroups.forEach(g => map.set(g.id, g));
    return Array.from(map.values());
  }, [groups, localExtraGroups]);

  // Current active project
  const currentGroup: GroupProject | undefined = useMemo(() => {
    return allGroups.find(g => g.id === activeGroupId);
  }, [allGroups, activeGroupId]);

  const currentUserId = isDemoMode ? 'demo-student' : (auth.currentUser?.uid || '');
  const isOwner = currentGroup ? (
    currentGroup.created_by === currentUserId ||
    (typeof currentGroup.member_details === 'object' &&
     currentGroup.member_details !== null &&
     currentGroup.member_details[currentUserId] &&
     typeof currentGroup.member_details[currentUserId] === 'object' &&
     currentGroup.member_details[currentUserId]?.role === 'owner') ||
    isDemoMode
  ) : false;

  const membersList: GroupMember[] = useMemo(() => {
    if (!currentGroup) return [];
    const validMembersSet = new Set(Array.isArray(currentGroup.members) ? currentGroup.members : []);
    const result: GroupMember[] = [];
    const memberDetails = (typeof currentGroup.member_details === 'object' && currentGroup.member_details !== null)
      ? currentGroup.member_details
      : {};

    for (const [key, val] of Object.entries(memberDetails)) {
      if (!val || typeof val !== 'object' || Array.isArray(val)) continue;
      const rawVal = val as any;
      const uid = typeof rawVal.uid === 'string' && rawVal.uid.trim() ? rawVal.uid.trim() : key;
      // Drop entries for uids not present in members
      if (validMembersSet.size > 0 && !validMembersSet.has(uid) && !validMembersSet.has(key)) continue;

      const displayName = typeof rawVal.displayName === 'string' && rawVal.displayName.trim()
        ? rawVal.displayName.trim()
        : 'UBC Student';
      const role: 'owner' | 'member' = rawVal.role === 'owner' ? 'owner' : 'member';
      const email = typeof rawVal.email === 'string' ? rawVal.email : '';
      const photoURL = typeof rawVal.photoURL === 'string' ? rawVal.photoURL : '';
      const joinedAt = typeof rawVal.joinedAt === 'string' ? rawVal.joinedAt : (currentGroup.created_at || new Date().toISOString());

      result.push({
        uid,
        displayName,
        email,
        photoURL,
        role,
        joinedAt
      });
    }

    // Synthesize fallback entries for members listed in members array but missing in member_details
    if (Array.isArray(currentGroup.members)) {
      for (const mUid of currentGroup.members) {
        if (!result.some(m => m.uid === mUid)) {
          result.push({
            uid: mUid,
            displayName: mUid === currentGroup.created_by ? 'Group Creator' : 'UBC Student',
            email: '',
            role: mUid === currentGroup.created_by ? 'owner' : 'member',
            joinedAt: currentGroup.created_at || new Date().toISOString()
          });
        }
      }
    }

    return result;
  }, [currentGroup]);

  // Filtered tasks
  const filteredTasks = useMemo(() => {
    return groupTasks.filter(t => {
      if (t.group_id !== currentGroup?.id) return false;
      if (filterAssignee !== 'all' && t.assigned_to !== filterAssignee) return false;
      if (filterStatus !== 'all') {
        const normalizedStatus = (t.status === 'In Progress') ? 'Working' : (t.status === 'In Review') ? 'Submitted' : t.status;
        if (normalizedStatus !== filterStatus && t.status !== filterStatus) return false;
      }
      return true;
    });
  }, [groupTasks, currentGroup?.id, filterAssignee, filterStatus]);

  // Overall statistics
  const totalTasks = groupTasks.length;
  const completedTasks = groupTasks.filter(t => t.status === 'Done').length;
  const completionPercentage = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  // Member contributions breakdown
  const memberContributions = useMemo(() => {
    return membersList.map(member => {
      const assigned = groupTasks.filter(t => t.assigned_to === member.uid || t.assigned_to === member.displayName);
      const done = assigned.filter(t => t.status === 'Done');
      const inProgress = assigned.filter(t => (t.status as string) === 'Working' || t.status === 'In Progress');
      const pct = assigned.length > 0 ? Math.round((done.length / assigned.length) * 100) : 0;
      const totalEstimated = assigned.reduce((sum, t) => sum + (t.estimated_hours || 0), 0);

      return {
        member,
        assignedCount: assigned.length,
        doneCount: done.length,
        inProgressCount: inProgress.length,
        completionPercentage: pct,
        totalEstimated,
        activeTasks: assigned.filter(t => t.status !== 'Done')
      };
    });
  }, [membersList, groupTasks]);

  const handleCopyInviteCode = async () => {
    if (!currentGroup?.invite_code) return;
    setCopiedCode(false);
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(currentGroup.invite_code);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    } catch {
      if (inviteCodeRef.current) {
        const range = document.createRange();
        range.selectNodeContents(inviteCodeRef.current);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        inviteCodeRef.current.focus();
      }
      showToast({ message: 'Copy unavailable. Select the invite code and copy it manually.' });
    }
  };

  const handleCreateGroupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (creatingGroupRef.current) return;
    setCreateError(null);
    if (!newGroupName.trim()) {
      setCreateError('Group name is required.');
      return;
    }
    if (!newGroupCourse.trim()) {
      setCreateError('Course code is required.');
      return;
    }
    if (newGroupName.trim().length > 200 || newGroupCourse.trim().length > 50) {
      setCreateError('Keep the group name to 200 characters and the course code to 50 characters or fewer.');
      return;
    }
    if (newGroupDesc.trim().length > 2000) {
      setCreateError('Keep the description to 2000 characters or fewer.');
      return;
    }

    creatingGroupRef.current = true;
    setIsCreatingGroup(true);
    try {
      let created = await createGroup({
        name: newGroupName.trim(),
        course_code: newGroupCourse.trim(),
        description: newGroupDesc.trim(),
        target_date: newGroupTargetDate
      });

      // Defensive fallback if createGroup returned incomplete object (e.g. mock or demo)
      if (!created || !created.id) {
        if (isDemoMode) {
          created = {
            id: `demo-group-${Date.now()}`,
            name: newGroupName.trim(),
            course_code: newGroupCourse.trim(),
            description: newGroupDesc.trim(),
            created_by: 'demo-student',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            invite_code: `UBC${Math.floor(100 + Math.random() * 900)}`,
            members: ['demo-student'],
            member_details: {
              'demo-student': {
                uid: 'demo-student',
                displayName: 'UBC Student',
                email: '',
                role: 'owner',
                joinedAt: new Date().toISOString()
              }
            },
            ...(newGroupTargetDate ? { target_date: newGroupTargetDate } : {})
          };
        } else {
          throw new Error('Could not create group. Please check your network and try again.');
        }
      }

      if (created) {
        setLocalExtraGroups(prev => [created, ...prev.filter(g => g.id !== created.id)]);
        setActiveGroupId(created.id);
        setIsCreateModalOpen(false);
        setNewGroupName('');
        setNewGroupCourse(courses[0]?.course_code || '');
        setNewGroupDesc('');
        setNewGroupTargetDate('');
        setCreateError(null);
        showToast({ 
          message: `Group "${created.name}" created! Invite code: ${created.invite_code}` 
        });
      } else {
        throw new Error('Could not create group.');
      }
    } catch (err: any) {
      console.error('Failed to create group:', err);
      // In demo mode, guarantee fallback in-memory creation so demo users never fail
      if (isDemoMode) {
        const fallbackGroup: GroupProject = {
          id: `demo-group-${Date.now()}`,
          name: newGroupName.trim(),
          course_code: newGroupCourse.trim(),
          description: newGroupDesc.trim(),
          created_by: 'demo-student',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          invite_code: `UBC${Math.floor(100 + Math.random() * 900)}`,
          members: ['demo-student'],
          member_details: {
            'demo-student': {
              uid: 'demo-student',
              displayName: 'UBC Student',
              email: '',
              role: 'owner',
              joinedAt: new Date().toISOString()
            }
          },
          ...(newGroupTargetDate ? { target_date: newGroupTargetDate } : {})
        };
        setLocalExtraGroups(prev => [fallbackGroup, ...prev.filter(g => g.id !== fallbackGroup.id)]);
        setActiveGroupId(fallbackGroup.id);
        setIsCreateModalOpen(false);
        setNewGroupName('');
        setNewGroupCourse(courses[0]?.course_code || '');
        setNewGroupDesc('');
        setNewGroupTargetDate('');
        setCreateError(null);
        showToast({ 
          message: `Group "${fallbackGroup.name}" created! Invite code: ${fallbackGroup.invite_code}` 
        });
        return;
      }
      // Keep modal open and show inline message
      setCreateError(groupFormError(err, 'create the group'));
    } finally {
      creatingGroupRef.current = false;
      setIsCreatingGroup(false);
    }
  };

  const handleJoinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!joinCodeInput.trim()) return;
    setJoinError(null);
    try {
      const joined = await joinGroupByCode(joinCodeInput.trim());
      if (joined) {
        setLocalExtraGroups(prev => [joined, ...prev.filter(g => g.id !== joined.id)]);
        setActiveGroupId(joined.id);
        showToast({ message: `Joined "${joined.name}"!` });
      }
      setIsJoinModalOpen(false);
      setJoinCodeInput('');
    } catch (err: any) {
      setJoinError(err.message || 'Could not join group');
    }
  };

  const handleLeaveGroup = async () => {
    if (!currentGroup) return;
    const confirmMsg = `Are you sure you want to leave "${currentGroup.name}"?`;
    if (!window.confirm(confirmMsg)) return;

    try {
      await leaveGroup(currentGroup.id);
      setLocalExtraGroups(prev => prev.filter(g => g.id !== currentGroup.id));
      showToast({ message: `Left group "${currentGroup.name}".` });
    } catch (err: any) {
      console.error('Failed to leave group:', err);
      showToast({ message: `Failed to leave group: ${err.message || 'Unknown error'}` });
    }
  };

  const handleDeleteGroup = async () => {
    if (!currentGroup) return;
    const confirmMsg = `Are you sure you want to permanently delete "${currentGroup.name}"? This will delete all tasks and cannot be undone.`;
    if (!window.confirm(confirmMsg)) return;

    try {
      if (!isDemoMode && auth.currentUser?.uid) {
        try {
          await deleteDoc(doc(db, 'groups', currentGroup.id));
        } catch (err) {
          console.warn('Firestore deleteDoc group error:', err);
        }
      }
      await leaveGroup(currentGroup.id);
      setLocalExtraGroups(prev => prev.filter(g => g.id !== currentGroup.id));
      showToast({ message: `Group "${currentGroup.name}" deleted.` });
    } catch (err: any) {
      console.error('Failed to delete group:', err);
      showToast({ message: `Failed to delete group: ${err.message || 'Unknown error'}` });
    }
  };

  const openEditGroupModal = () => {
    if (!currentGroup) return;
    setEditGroupName(currentGroup.name);
    setEditGroupCourse(currentGroup.course_code);
    setEditGroupDesc(currentGroup.description || '');
    setEditGroupTargetDate(currentGroup.target_date || '');
    setEditGroupError(null);
    setIsEditGroupModalOpen(true);
  };

  const handleEditGroupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentGroup || !editGroupName.trim()) {
      setEditGroupError('Group name is required.');
      return;
    }

    setIsSubmittingEdit(true);
    setEditGroupError(null);
    try {
      const nowIso = new Date().toISOString();
      const updatedFields = {
        name: editGroupName.trim(),
        course_code: editGroupCourse.trim() || 'General',
        description: editGroupDesc.trim(),
        target_date: editGroupTargetDate,
        updated_at: nowIso
      };

      if (!isDemoMode && auth.currentUser?.uid) {
        const groupRef = doc(db, 'groups', currentGroup.id);
        await updateDoc(groupRef, updatedFields);
      }

      // Mutate and update local extra groups
      Object.assign(currentGroup, updatedFields);
      setLocalExtraGroups(prev => {
        const exists = prev.some(g => g.id === currentGroup.id);
        const updated = { ...currentGroup, ...updatedFields };
        return exists ? prev.map(g => g.id === currentGroup.id ? updated : g) : [...prev, updated];
      });

      setIsEditGroupModalOpen(false);
      showToast({ message: `Group "${updatedFields.name}" updated.` });
    } catch (err: any) {
      console.error('Failed to update group:', err);
      setEditGroupError(err.message || 'Failed to update group');
    } finally {
      setIsSubmittingEdit(false);
    }
  };

  const handleRemoveMember = async (memberUid: string, memberName: string) => {
    if (!currentGroup) return;
    const safeName = memberName || 'this member';
    if (!window.confirm(`Remove ${safeName} from "${currentGroup.name}"?`)) return;

    try {
      const newMembers = (currentGroup.members || []).filter(m => m !== memberUid);
      const newMemberDetails = (typeof currentGroup.member_details === 'object' && currentGroup.member_details !== null)
        ? { ...currentGroup.member_details }
        : {};
      delete newMemberDetails[memberUid];

      if (!isDemoMode && auth.currentUser?.uid) {
        const groupRef = doc(db, 'groups', currentGroup.id);
        await updateDoc(groupRef, {
          members: newMembers,
          member_details: newMemberDetails,
          updated_at: new Date().toISOString()
        });
      }

      currentGroup.members = newMembers;
      currentGroup.member_details = newMemberDetails;

      setLocalExtraGroups(prev => {
        return prev.map(g => {
          if (g.id !== currentGroup.id) return g;
          return {
            ...g,
            members: newMembers,
            member_details: newMemberDetails
          };
        });
      });

      showToast({ message: `Removed ${safeName} from the group.` });
    } catch (err: any) {
      console.error('Failed to remove member:', err);
      alert(err.message || 'Failed to remove member');
    }
  };

  const openTaskModal = (task?: GroupTask) => {
    if (!currentGroup || (task && task.group_id !== currentGroup.id)) return;
    setTaskSaveError(null);
    if (task) {
      setEditingTask(task);
      setTaskTitle(task.title);
      setTaskDesc(task.description || '');
      setTaskDue(task.due_at ? formatInTimeZone(new Date(task.due_at), 'America/Vancouver', "yyyy-MM-dd'T'HH:mm") : '');
      setTaskPriority(task.priority);
      const mappedStatus = (task.status === 'In Progress') ? 'Working' : (task.status === 'In Review') ? 'Submitted' : task.status;
      setTaskStatus(mappedStatus);
      setTaskAssignee(task.assigned_to || '');
      setTaskEstHours(task.estimated_hours ? String(task.estimated_hours) : '');
      setSubtasksList((task.subtasks || []).map(st => ({
        ...(st.id ? { id: st.id } : {}),
        title: st.title,
        done: st.done,
        ...(st.assigned_to ? { assigned_to: st.assigned_to } : {})
      })));
    } else {
      setEditingTask(null);
      setTaskTitle('');
      setTaskDesc('');
      setTaskDue('');
      setTaskPriority('Medium');
      setTaskStatus('Not Started');
      setTaskAssignee('');
      setTaskEstHours('2');
      setSubtasksList([]);
    }
    setIsTaskModalOpen(true);
  };

  const handleSaveTaskSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (savingTaskRef.current) return;
    if (!currentGroup || !taskTitle.trim()) return;
    if (taskTitle.trim().length > 300 || taskDesc.trim().length > 5000) {
      setTaskSaveError('Keep the task title to 300 characters and the description to 5000 characters or fewer.');
      return;
    }
    if (editingTask && editingTask.group_id !== currentGroup.id) {
      setTaskSaveError('This task is no longer in the active group. Reopen the task and try again.');
      return;
    }

    savingTaskRef.current = true;
    setIsSavingTask(true);
    setTaskSaveError(null);

    const matchedMember = membersList.find(m => m.uid === taskAssignee || m.displayName === taskAssignee);
    const assigneeName = matchedMember ? matchedMember.displayName : (taskAssignee.trim() ? taskAssignee.trim() : undefined);
    const parsedHours = parseFloat(taskEstHours);
    const validEstHours = (!isNaN(parsedHours) && parsedHours > 0) ? parsedHours : undefined;

    // Preserve existing subtask IDs to prevent race conditions and lost subtask ticks
    const preservedSubtasks = subtasksList.map((st, i) => ({
      id: st.id && st.id.trim() ? st.id.trim() : `st-${Date.now()}-${i}`,
      title: st.title.trim(),
      done: !!st.done,
      ...(st.assigned_to ? { assigned_to: st.assigned_to } : {})
    }));

    const isRealAccount = !isDemoMode && !!auth.currentUser?.uid;

    try {
      if (isRealAccount && editingTask) {
        // Field-level update using updateDoc to avoid full-object overwrites and race conditions.
        // Cleared assignee or estimate explicitly writes deleteField() so Firestore drops them.
        const taskRef = doc(db, 'groups', currentGroup.id, 'tasks', editingTask.id);
        const updateData: Record<string, any> = {
          title: taskTitle.trim(),
          description: taskDesc.trim(),
          due_at: taskDue ? zonedTimeToUtc(taskDue, 'America/Vancouver').toISOString() : '',
          priority: taskPriority,
          status: taskStatus === 'Working' ? 'In Progress' : taskStatus === 'Submitted' ? 'In Review' : taskStatus,
          assigned_to: taskAssignee.trim() ? taskAssignee.trim() : deleteField(),
          assignee_name: (taskAssignee.trim() && assigneeName) ? assigneeName : deleteField(),
          estimated_hours: validEstHours !== undefined ? validEstHours : deleteField(),
          subtasks: preservedSubtasks,
          updated_at: new Date().toISOString(),
          last_modified_by: auth.currentUser!.uid
        };
        await updateDoc(taskRef, updateData);
      } else {
        // New task creation or demo mode
        const taskPayload: any = {
          ...(editingTask ? { id: editingTask.id } : {}),
          title: taskTitle.trim(),
          description: taskDesc.trim(),
          due_at: taskDue ? zonedTimeToUtc(taskDue, 'America/Vancouver').toISOString() : '',
          priority: taskPriority,
          status: isRealAccount ? (taskStatus === 'Working' ? 'In Progress' : taskStatus === 'Submitted' ? 'In Review' : taskStatus) : taskStatus,
          ...(taskAssignee.trim() ? { assigned_to: taskAssignee.trim() } : {}),
          ...(taskAssignee.trim() && assigneeName ? { assignee_name: assigneeName } : {}),
          ...(validEstHours !== undefined ? { estimated_hours: validEstHours } : {}),
          subtasks: preservedSubtasks
        };
        await saveGroupTaskAction(currentGroup.id, taskPayload);
      }

      setIsTaskModalOpen(false);
      showToast({ message: editingTask ? 'Task updated.' : 'Task added.' });
    } catch (err: any) {
      console.error('Failed to save group task:', err);
      const errMsg = groupFormError(err, 'save the task');
      setTaskSaveError(errMsg);
      showToast({ message: `Failed to save task: ${errMsg}` });
    } finally {
      savingTaskRef.current = false;
      setIsSavingTask(false);
    }
  };

  const handleToggleSubtaskDone = async (task: GroupTask, subtaskId: string) => {
    if (!currentGroup || task.group_id !== currentGroup.id) return;
    try {
      const updatedSubtasks = (task.subtasks || []).map(st => 
        st.id === subtaskId ? { ...st, done: !st.done } : st
      );
      if (!isDemoMode && auth.currentUser?.uid) {
        // Field-level update: avoid spreading entire task or overwriting teammate fields
        const taskRef = doc(db, 'groups', currentGroup.id, 'tasks', task.id);
        await updateDoc(taskRef, {
          subtasks: updatedSubtasks,
          updated_at: new Date().toISOString(),
          last_modified_by: auth.currentUser!.uid
        });
      } else {
        await saveGroupTaskAction(currentGroup.id, {
          ...task,
          subtasks: updatedSubtasks
        });
      }
    } catch (err: any) {
      console.error('Failed to toggle subtask:', err);
      showToast({ message: `Failed to update subtask: ${err.message || 'Permission denied or network error'}` });
    }
  };

  const handleUpdateStatus = async (task: GroupTask, newStatus: TaskStatus | GroupTaskStatus) => {
    if (!currentGroup || task.group_id !== currentGroup.id) return;
    try {
      if (!isDemoMode && auth.currentUser?.uid) {
        // Field-level update: only update status and updated_at
        const taskRef = doc(db, 'groups', currentGroup.id, 'tasks', task.id);
        await updateDoc(taskRef, {
          status: newStatus,
          updated_at: new Date().toISOString(),
          last_modified_by: auth.currentUser!.uid
        });
      } else {
        await saveGroupTaskAction(currentGroup.id, {
          ...task,
          status: newStatus as any
        });
      }
    } catch (err: any) {
      console.error('Failed to update task status:', err);
      showToast({ message: `Failed to update status: ${err.message || 'Permission denied or network error'}` });
    }
  };

  const handleDeleteTask = async (task: GroupTask) => {
    if (!currentGroup || task.group_id !== currentGroup.id) return;
    if (!window.confirm(`Permanently delete group task "${task.title}"? This cannot be undone.`)) return;
    try {
      await deleteGroupTaskAction(currentGroup.id, task.id);
      showToast({ message: `Deleted task "${task.title}".` });
    } catch (err: any) {
      console.error('Failed to delete group task:', err);
      showToast({ message: `Failed to delete task: ${err.message || 'Permission denied or network error'}` });
      // Restore task if delete failed in TaskProvider optimistic state
      try {
        await saveGroupTaskAction(currentGroup.id, task);
      } catch (restoreErr) {
        console.warn('Could not restore task after failed delete:', restoreErr);
      }
    }
  };

  const handleAddSubtaskDraft = () => {
    if (!newSubtaskTitle.trim()) return;
    setSubtasksList(prev => [
      ...prev, 
      { id: `st-${Date.now()}-${prev.length}`, title: newSubtaskTitle.trim(), done: false }
    ]);
    setNewSubtaskTitle('');
  };

  return (
    <div className="space-y-6">
      {/* Top Header & Group Selector Bar */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4 flex-wrap min-w-0 max-w-full">
          {/* Project dropdown */}
          <div className="flex items-center gap-2 w-full max-w-full min-w-0 md:w-auto">
            <Users className="text-blue-600 shrink-0" size={22} />
            <select
              id="group-project-selector"
              aria-label="Select group"
              value={currentGroup?.id || ''}
              onChange={(e) => setActiveGroupId(e.target.value)}
              className="w-full max-w-full min-w-0 truncate font-black text-slate-900 text-lg bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 focus:outline-hidden focus:ring-2 focus:ring-blue-500 cursor-pointer"
            >
              {allGroups.map(g => (
                <option key={g.id} value={g.id}>
                  {g.course_code && !g.name.toLowerCase().startsWith(g.course_code.toLowerCase()) ? `${g.course_code}: ${g.name}` : g.name}
                </option>
              ))}
            </select>
          </div>

          {currentGroup && (
            <div className="flex items-center gap-2">
              {currentGroup.course_code && !currentGroup.name.toLowerCase().startsWith(currentGroup.course_code.toLowerCase()) && (
                <span className={`text-xs font-bold px-2 py-0.5 rounded-md ${getCourseColor(currentGroup.course_code)}`}>
                  {currentGroup.course_code}
                </span>
              )}
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 bg-slate-100 px-2.5 py-1 rounded-lg border border-slate-200">
                <span>Code: <strong ref={inviteCodeRef} tabIndex={0} className="select-text">{currentGroup.invite_code || 'No invite code'}</strong></span>
                <button
                  type="button"
                  onClick={handleCopyInviteCode}
                  disabled={!currentGroup.invite_code}
                  className="p-1 hover:bg-slate-200 rounded transition-colors cursor-pointer"
                  aria-label={copiedCode ? 'Invite code copied' : 'Copy invite code'}
                  title={currentGroup.invite_code ? 'Copy invite code to share with teammates' : 'This group has no invite code'}
                >
                  {currentGroup.invite_code && (copiedCode ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} />)}
                </button>
              </span>
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          {currentGroup && (
            <>
              <button
                id="edit-group-btn"
                type="button"
                onClick={openEditGroupModal}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl transition-colors cursor-pointer"
                title="Edit group details"
              >
                <Edit2 size={13} />
                <span>Edit Group</span>
              </button>

              <button
                id="leave-group-btn"
                type="button"
                onClick={handleLeaveGroup}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-xl transition-colors cursor-pointer"
                title="Leave this group"
              >
                <LogOut size={13} />
                <span>Leave Group</span>
              </button>

              {isOwner && (
                <button
                  id="delete-group-btn"
                  type="button"
                  onClick={handleDeleteGroup}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-xl transition-colors cursor-pointer"
                  title="Permanently delete group"
                >
                  <Trash2 size={13} />
                  <span>Delete Group</span>
                </button>
              )}
            </>
          )}

          <button
            type="button"
            onClick={() => setIsJoinModalOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl transition-colors cursor-pointer"
          >
            <UserPlus size={14} />
            <span>Join a group</span>
          </button>

          <button
            type="button"
            onClick={() => { if (!newGroupCourse.trim()) setNewGroupCourse(courses[0]?.course_code || ''); setIsCreateModalOpen(true); setCreateError(null); }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl shadow-xs transition-colors cursor-pointer"
          >
            <Plus size={14} />
            <span>New group</span>
          </button>
        </div>
      </div>

      {currentGroup ? (
        <>
          {/* Project Progress Overview Card */}
          <div className="bg-gradient-to-r from-blue-900 via-indigo-900 to-slate-900 text-white rounded-2xl p-6 shadow-md border border-white/10">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-bold uppercase tracking-wider text-blue-300">
                    Group
                  </span>
                  {currentGroup.target_date && (
                    <span className="text-xs text-blue-200">
                      • Due {formatVancouverDate(currentGroup.target_date)}
                    </span>
                  )}
                </div>
                <h2 className="text-2xl font-black text-white tracking-tight">{currentGroup.name}</h2>
                <p className="text-xs text-blue-200 mt-1 max-w-xl">
                  {currentGroup.description || 'Assign tasks to teammates and break them into steps.'}
                </p>

                {/* Team Avatars */}
                <div className="flex items-center gap-2 mt-4 flex-wrap">
                  <span className="text-xs font-semibold text-blue-200">Members ({membersList.length}):</span>
                  <div className="flex -space-x-1.5">
                    {membersList.map((m, idx) => (
                      <div
                        key={m.uid || idx}
                        title={`${m.displayName || 'UBC Student'} (${m.role || 'member'})`}
                        className="w-7 h-7 rounded-full bg-blue-600 text-white font-bold text-xs flex items-center justify-center ring-2 ring-indigo-900 shadow-xs uppercase"
                      >
                        {(m.displayName || '?').substring(0, 2)}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Progress Gauges */}
              <div className="flex items-center gap-4 flex-wrap">
                <div className="bg-white/10 backdrop-blur-xs rounded-xl p-3.5 border border-white/10 min-w-[130px]">
                  <p className="text-[10px] font-bold text-blue-200 uppercase tracking-wider">Milestone Progress</p>
                  <p className="text-3xl font-black text-white mt-0.5">{completionPercentage}%</p>
                  <div className="w-full bg-white/20 h-1.5 rounded-full mt-2 overflow-hidden">
                    <div className="bg-emerald-400 h-full rounded-full transition-all" style={{ width: `${completionPercentage}%` }} />
                  </div>
                </div>

                <div className="bg-white/10 backdrop-blur-xs rounded-xl p-3.5 border border-white/10 min-w-[110px]">
                  <p className="text-[10px] font-bold text-blue-200 uppercase tracking-wider">Completed</p>
                  <p className="text-2xl font-extrabold text-emerald-300 mt-1">{completedTasks} / {totalTasks}</p>
                  <p className="text-[10px] text-blue-300 mt-0.5">Tasks done</p>
                </div>
              </div>
            </div>
          </div>

          {/* Sub-tabs: Shared Tasks vs Who's Doing What */}
          <div className="flex items-center justify-between gap-4 border-b border-slate-200 pb-2 flex-wrap">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setActiveSubTab('tasks')}
                className={`flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-xl transition-all cursor-pointer ${
                  activeSubTab === 'tasks'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
                }`}
              >
                <CheckSquare size={14} />
                <span>Group tasks ({groupTasks.length})</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveSubTab('contributions')}
                className={`flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-xl transition-all cursor-pointer ${
                  activeSubTab === 'contributions'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
                }`}
              >
                <PieChart size={14} />
                <span>Who's Doing What</span>
              </button>
            </div>

            {activeSubTab === 'tasks' && (
              <div className="flex items-center gap-2 flex-wrap">
                {/* Filter Assignee */}
                <select
                  id="group-filter-assignee"
                  aria-label="Filter by assignee"
                  value={filterAssignee}
                  onChange={(e) => setFilterAssignee(e.target.value)}
                  className="text-xs font-semibold bg-white border border-slate-200 rounded-xl px-2.5 py-1.5 text-slate-700 focus:outline-hidden"
                >
                  <option value="all">All Assignees</option>
                  {membersList.map(m => (
                    <option key={m.uid} value={m.uid}>{m.displayName || 'UBC Student'}</option>
                  ))}
                </select>

                {/* Filter Status */}
                <select
                  id="group-filter-status"
                  aria-label="Filter by status"
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value)}
                  className="text-xs font-semibold bg-white border border-slate-200 rounded-xl px-2.5 py-1.5 text-slate-700 focus:outline-hidden"
                >
                  <option value="all">All Statuses</option>
                  <option value="Not Started">Not Started</option>
                  <option value="Working">Working</option>
                  <option value="Submitted">Submitted</option>
                  <option value="Done">Done</option>
                </select>

                <button
                  type="button"
                  onClick={() => openTaskModal()}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl shadow-xs transition-colors cursor-pointer"
                >
                  <Plus size={13} />
                  <span>Add group task</span>
                </button>
              </div>
            )}
          </div>

          {/* Tab Content */}
          {activeSubTab === 'tasks' ? (
            <div className="space-y-3">
              {filteredTasks.length === 0 ? (
                <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-slate-600">
                  <CheckSquare size={32} className="mx-auto text-slate-400 mb-2" />
                  <p className="text-sm font-bold text-slate-700">No group tasks found</p>
                  <p className="text-xs text-slate-600 mt-1">Tap "Add group task" to assign a task to a teammate.</p>
                </div>
              ) : (
                filteredTasks.map((task) => {
                  const isDone = task.status === 'Done';
                  const subtasksTotal = (task.subtasks || []).length;
                  const subtasksCompleted = (task.subtasks || []).filter(st => st.done).length;

                  return (
                    <div
                      key={task.id}
                      className={`bg-white rounded-2xl border p-4 shadow-2xs transition-all hover:border-slate-300 ${
                        isDone ? 'border-slate-200 opacity-75 bg-slate-50/50' : 'border-slate-200'
                      }`}
                    >
                      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                        <div className="flex items-start gap-3">
                          {/* Step 83 compatibility: aria-label={isDone ? `Mark ${task.title} incomplete` : `Mark ${task.title} complete`} */}
                          <button
                            type="button"
                            onClick={() => handleUpdateStatus(task, isDone ? 'Working' : 'Done')}
                            aria-label={isDone ? `Mark "${task.title}" in progress` : `Mark "${task.title}" done`}
                            aria-pressed={isDone}
                            title={isDone ? `Mark "${task.title}" in progress` : `Mark "${task.title}" done`}
                            className="mt-0.5 w-10 h-10 min-w-10 min-h-10 flex items-center justify-center text-slate-400 hover:text-blue-600 transition-colors cursor-pointer"
                          >
                            {isDone ? (
                              <CheckCircle2 size={24} className="text-emerald-600 w-6 h-6" />
                            ) : (
                              <Circle size={24} className="w-6 h-6" />
                            )}
                          </button>

                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <h4 className={`text-sm font-bold ${isDone ? 'line-through text-slate-600' : 'text-slate-900'}`}>
                                {task.title}
                              </h4>
                              
                              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${
                                task.priority === 'Critical' ? 'bg-rose-100 text-rose-700' :
                                task.priority === 'High' ? 'bg-amber-100 text-amber-700' :
                                'bg-slate-100 text-slate-600'
                              }`}>
                                {task.priority}
                              </span>

                              <select
                                id={`task-status-select-${task.id}`}
                                aria-label={`Status for ${task.title}`}
                                value={task.status === 'In Progress' ? 'Working' : task.status === 'In Review' ? 'Submitted' : task.status}
                                onChange={(e) => handleUpdateStatus(task, e.target.value as any)}
                                className={`text-[10px] font-bold px-2 py-0.5 rounded-md border cursor-pointer ${
                                  task.status === 'Done' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                                  ((task.status as string) === 'Working' || task.status === 'In Progress') ? 'bg-blue-50 text-blue-700 border-blue-200' :
                                  ((task.status as string) === 'Submitted' || task.status === 'In Review') ? 'bg-purple-50 text-purple-700 border-purple-200' :
                                  'bg-slate-50 text-slate-600 border-slate-200'
                                }`}
                              >
                                <option value="Not Started">Not Started</option>
                                <option value="Working">Working</option>
                                <option value="Submitted">Submitted</option>
                                <option value="Done">Done</option>
                              </select>
                            </div>

                            {task.description && (
                              <p className="text-xs text-slate-600 mt-1">{task.description}</p>
                            )}

                            {/* Subtasks */}
                            {subtasksTotal > 0 && (
                              <div className="mt-3 pl-2 border-l-2 border-slate-100 space-y-1.5">
                                <span className="text-[10px] font-bold text-slate-600 uppercase tracking-wider block">
                                  Subtasks ({subtasksCompleted}/{subtasksTotal})
                                </span>
                                {task.subtasks?.map(st => (
                                  <label
                                    key={st.id}
                                    htmlFor={`subtask-toggle-${task.id}-${st.id}`}
                                    className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer hover:text-slate-900"
                                  >
                                    <input
                                      type="checkbox"
                                      id={`subtask-toggle-${task.id}-${st.id}`}
                                      aria-label={`${st.title} (${st.done ? 'completed' : 'not completed'})`}
                                      checked={st.done}
                                      onChange={() => handleToggleSubtaskDone(task, st.id)}
                                      className="rounded text-blue-600 focus:ring-0 cursor-pointer"
                                    />
                                    <span className={st.done ? 'line-through text-slate-600' : 'text-slate-700'}>
                                      {st.title}
                                    </span>
                                  </label>
                                ))}
                              </div>
                            )}

                            {/* Meta info */}
                            <div className="flex items-center gap-4 text-[11px] text-slate-600 mt-2.5 flex-wrap">
                              {task.assignee_name && (
                                <span className="flex items-center gap-1 font-semibold text-slate-700">
                                  <Users size={12} className="text-slate-400" />
                                  <span>Assigned: <strong>{task.assignee_name}</strong></span>
                                </span>
                              )}

                              {task.due_at && (
                                <span className="flex items-center gap-1">
                                  <Calendar size={12} className="text-slate-400" />
                                  <span>Due {formatVancouverDate(task.due_at)}</span>
                                </span>
                              )}

                              {task.estimated_hours && (
                                <span className="flex items-center gap-1">
                                  <Clock size={12} className="text-slate-400" />
                                  <span>{task.estimated_hours}h estimated</span>
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Task item action menu */}
                        <div className="flex items-center gap-1 self-end sm:self-auto">
                          <button
                            type="button"
                            onClick={() => openTaskModal(task)}
                            className="min-h-10 min-w-10 flex items-center justify-center p-2 text-slate-400 hover:text-blue-600 rounded-lg hover:bg-slate-100 transition-colors"
                            title="Edit task"
                            aria-label="Edit task"
                          >
                            <Edit2 size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteTask(task)}
                            className="min-h-11 min-w-11 flex items-center justify-center p-2 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-slate-100 transition-colors"
                            title="Delete task"
                            aria-label="Delete task"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          ) : (
            /* Who's Doing What / Contribution View */
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {memberContributions.map(({ member, assignedCount, doneCount, inProgressCount, completionPercentage, totalEstimated, activeTasks }) => (
                <div key={member.uid} className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-blue-600 text-white font-black text-sm flex items-center justify-center uppercase shadow-2xs">
                        {(member.displayName || '?').substring(0, 2)}
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-slate-900">{member.displayName || 'UBC Student'}</h4>
                        <span className="text-[10px] font-semibold text-slate-600 uppercase tracking-wider">
                          {member.role || 'Member'}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-extrabold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-md">
                        {completionPercentage}% Done
                      </span>
                      {isOwner && member.uid !== currentUserId && (
                        <button
                          type="button"
                          onClick={() => handleRemoveMember(member.uid, member.displayName || 'UBC Student')}
                          title={`Remove ${member.displayName || 'Member'} from group`}
                          aria-label={`Remove ${member.displayName || 'Member'} from group`}
                          className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Progress bar */}
                  <div>
                    <div className="flex items-center justify-between text-xs text-slate-600 mb-1 font-medium">
                      <span>Tasks Delivered</span>
                      <span><strong>{doneCount}</strong> / {assignedCount}</span>
                    </div>
                    <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                      <div
                        className="bg-emerald-500 h-full rounded-full transition-all"
                        style={{ width: `${completionPercentage}%` }}
                      />
                    </div>
                  </div>

                  {/* Workload breakdown stats */}
                  <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-100 text-xs">
                    <div className="bg-slate-50 rounded-xl p-2.5">
                      <span className="text-[10px] font-bold text-slate-600 uppercase tracking-wider block">Working</span>
                      <span className="text-base font-black text-slate-800">{inProgressCount}</span>
                    </div>
                    <div className="bg-slate-50 rounded-xl p-2.5">
                      <span className="text-[10px] font-bold text-slate-600 uppercase tracking-wider block">Est. Hours</span>
                      <span className="text-base font-black text-slate-800">{totalEstimated}h</span>
                    </div>
                  </div>

                  {/* Active tasks list */}
                  {activeTasks.length > 0 && (
                    <div className="space-y-1.5 pt-1">
                      <span className="text-[10px] font-bold text-slate-600 uppercase tracking-wider block">
                        Currently Working On:
                      </span>
                      {activeTasks.slice(0, 3).map(at => (
                        <div key={at.id} className="text-xs text-slate-700 bg-slate-50 p-2 rounded-lg truncate flex items-center justify-between">
                          <span className="truncate">{at.title}</span>
                          <span className={`text-[9px] font-bold px-1.5 py-0.2 rounded-sm ml-1 ${
                            ((at.status as string) === 'Working' || at.status === 'In Progress') ? 'bg-blue-100 text-blue-700' :
                            ((at.status as string) === 'Submitted' || at.status === 'In Review') ? 'bg-purple-100 text-purple-700' :
                            at.status === 'Done' ? 'bg-emerald-100 text-emerald-700' :
                            'bg-slate-200 text-slate-600'
                          }`}>
                            {at.status === 'In Progress' ? 'Working' : at.status === 'In Review' ? 'Submitted' : at.status}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        /* No group created yet */
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center max-w-lg mx-auto">
          <FolderGit2 size={40} className="mx-auto text-blue-600 mb-3" />
          <h3 className="text-lg font-black text-slate-900">
            {groups.length === 0 ? 'No groups yet' : 'No group selected'}
          </h3>
          <p className="text-xs text-slate-600 mt-1 mb-6">
            {groups.length === 0
              ? 'No groups yet — create one and share the invite code, or join with a code from a teammate.'
              : 'Create a group or join an existing group with an invite code.'}
          </p>
          <div className="flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => setIsJoinModalOpen(true)}
              className="px-4 py-2 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer"
            >
              Join a group
            </button>
            <button
              type="button"
              onClick={() => { if (!newGroupCourse.trim()) setNewGroupCourse(courses[0]?.course_code || ''); setIsCreateModalOpen(true); setCreateError(null); }}
              className="px-4 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl shadow-xs transition-colors cursor-pointer"
            >
              Create group
            </button>
          </div>
        </div>
      )}

      {/* CREATE GROUP MODAL */}
      {isCreateModalOpen && (
        <div onClick={createModal.handleBackdropClick} className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in">
          <div ref={createModal.modalRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="create-group-title" className="bg-white rounded-2xl p-6 w-full max-w-md shadow-2xl border border-slate-200 text-slate-800">
            <h3 id="create-group-title" className="text-lg font-black text-slate-900 flex items-center gap-2">
              <Plus size={18} className="text-blue-600" />
              New group
            </h3>
            <p className="text-xs text-slate-600 mt-1">
              Create a group with an invite code for your classmates.
            </p>

            {createError && (
              <div id="create-group-error-msg" role="alert" className="mt-3 p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
                <AlertCircle size={14} className="shrink-0" />
                <span>{createError}</span>
              </div>
            )}

            <form onSubmit={handleCreateGroupSubmit} className="space-y-4 mt-4">
              <div>
                <label htmlFor="new-group-name" className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Group name *
                </label>
                <input
                  id="new-group-name"
                  maxLength={200}
                  type="text"
                  required
                  placeholder="e.g. CPSC 310 Milestone 1"
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm font-semibold text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="new-group-course" className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Course Code *
                  </label>
                  <input
                    id="new-group-course"
                    maxLength={50}
                    list="group-course-options"
                    type="text"
                    required
                    placeholder="CPSC 310"
                    value={newGroupCourse}
                    onChange={(e) => setNewGroupCourse(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm font-semibold text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                  />
                  <datalist id="group-course-options">
                    {courses.map(course => <option key={course.id} value={course.course_code} />)}
                  </datalist>
                </div>

                <div>
                  <label htmlFor="new-group-target-date" className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Target Date
                  </label>
                  <input
                    id="new-group-target-date"
                    type="date"
                    value={newGroupTargetDate}
                    onChange={(e) => setNewGroupTargetDate(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm font-semibold text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="new-group-desc" className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Description
                </label>
                <textarea
                  id="new-group-desc"
                  maxLength={2000}
                  rows={2}
                  placeholder="Goals, assignments, or GitHub repo links..."
                  value={newGroupDesc}
                  onChange={(e) => setNewGroupDesc(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => { setIsCreateModalOpen(false); setCreateError(null); }}
                  className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  id="submit-create-group-btn"
                  type="submit"
                  disabled={isCreatingGroup}
                  className="px-4 py-2 text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-xs transition-colors cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
                >
                  {isCreatingGroup ? (
                    <>
                      <Clock size={13} className="animate-spin" />
                      <span>Creating...</span>
                    </>
                  ) : (
                    <span>Create group</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* EDIT GROUP MODAL */}
      {isEditGroupModalOpen && currentGroup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in">
          <div ref={editGroupModal.modalRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="edit-group-title" className="bg-white rounded-2xl p-6 w-full max-w-md shadow-2xl border border-slate-200 text-slate-800">
            <h3 id="edit-group-title" className="text-lg font-black text-slate-900 flex items-center gap-2">
              <Edit2 size={18} className="text-blue-600" />
              Edit group
            </h3>
            <p className="text-xs text-slate-600 mt-1">
              Update the group name, course code, target date, or description.
            </p>

            {editGroupError && (
              <div id="edit-group-error-msg" className="mt-3 p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
                <AlertCircle size={14} className="shrink-0" />
                <span>{editGroupError}</span>
              </div>
            )}

            <form onSubmit={handleEditGroupSubmit} className="space-y-4 mt-4">
              <div>
                <label htmlFor="edit-group-name" className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Group name *
                </label>
                <input
                  id="edit-group-name"
                  type="text"
                  required
                  placeholder="e.g. CPSC 310 Milestone 1"
                  value={editGroupName}
                  onChange={(e) => setEditGroupName(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm font-semibold text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="edit-group-course" className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Course Code *
                  </label>
                  <input
                    id="edit-group-course"
                    type="text"
                    required
                    placeholder="CPSC 310"
                    value={editGroupCourse}
                    onChange={(e) => setEditGroupCourse(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm font-semibold text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label htmlFor="edit-group-target-date" className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Target Date
                  </label>
                  <input
                    id="edit-group-target-date"
                    type="date"
                    value={editGroupTargetDate}
                    onChange={(e) => setEditGroupTargetDate(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm font-semibold text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="edit-group-desc" className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Description
                </label>
                <textarea
                  id="edit-group-desc"
                  rows={2}
                  placeholder="Goals, assignments, or GitHub repo links..."
                  value={editGroupDesc}
                  onChange={(e) => setEditGroupDesc(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => { setIsEditGroupModalOpen(false); setEditGroupError(null); }}
                  className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  id="submit-edit-group-btn"
                  type="submit"
                  disabled={isSubmittingEdit}
                  className="px-4 py-2 text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-xs transition-colors cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
                >
                  {isSubmittingEdit ? (
                    <>
                      <Clock size={13} className="animate-spin" />
                      <span>Saving...</span>
                    </>
                  ) : (
                    <span>Save Changes</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* JOIN GROUP MODAL */}
      {isJoinModalOpen && (
        <div onClick={joinModal.handleBackdropClick} className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in">
          <div ref={joinModal.modalRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="join-group-title" className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl border border-slate-200 text-slate-800">
            <h3 id="join-group-title" className="text-lg font-black text-slate-900 flex items-center gap-2">
              <UserPlus size={18} className="text-blue-600" />
              Join a group
            </h3>
            <p className="text-xs text-slate-600 mt-1">
              Enter the invite code shared by your teammate.
            </p>

            {joinError && (
              <div className="mt-3 p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
                <AlertCircle size={14} className="shrink-0" />
                <span>{joinError}</span>
              </div>
            )}

            <form onSubmit={handleJoinSubmit} className="space-y-4 mt-4">
              <div>
                <label htmlFor="join-group-code" className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Invite Code (e.g. UBC310)
                </label>
                <input
                  id="join-group-code"
                  type="text"
                  required
                  placeholder="UBC310"
                  value={joinCodeInput}
                  onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase())}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-base font-black tracking-widest text-slate-900 uppercase focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => { setIsJoinModalOpen(false); setJoinError(null); }}
                  className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-xs transition-colors cursor-pointer"
                >
                  Join
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ADD / EDIT GROUP TASK MODAL */}
      {isTaskModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in">
          <div ref={taskModal.modalRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="group-task-title" className="bg-white rounded-2xl p-6 w-full max-w-lg shadow-2xl border border-slate-200 text-slate-800 max-h-[90vh] overflow-y-auto">
            <h3 id="group-task-title" className="text-lg font-black text-slate-900 flex items-center gap-2">
              <CheckSquare size={18} className="text-blue-600" />
              {editingTask ? 'Edit group task' : 'Add group task'}
            </h3>
            <p className="text-xs text-slate-600 mt-1">
              Assign tasks to teammates and break them into steps.
            </p>

            {taskSaveError && (
              <div id="task-modal-error-msg" role="alert" className="p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-start gap-2 text-xs text-rose-700 font-medium mt-3">
                <AlertCircle size={14} className="mt-0.5 shrink-0 text-rose-500" />
                <span>{taskSaveError}</span>
              </div>
            )}

            <form onSubmit={handleSaveTaskSubmit} className="space-y-4 mt-4">
              <div>
                <label htmlFor="task-title" className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Task Title *
                </label>
                <input
                  id="task-title"
                  maxLength={300}
                  type="text"
                  required
                  placeholder="e.g. Implement REST API endpoints"
                  value={taskTitle}
                  onChange={(e) => setTaskTitle(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm font-semibold text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="task-assignee" className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Assignee
                  </label>
                  <select
                    id="task-assignee"
                    aria-label="Assignee"
                    value={taskAssignee}
                    onChange={(e) => setTaskAssignee(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs font-semibold text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Unassigned</option>
                    {membersList.map(m => (
                      <option key={m.uid} value={m.uid}>{m.displayName || 'UBC Student'}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="task-due" className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Due Date
                  </label>
                  <input
                    id="task-due"
                    type="datetime-local"
                    value={taskDue}
                    onChange={(e) => setTaskDue(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs font-semibold text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label htmlFor="task-priority" className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Priority
                  </label>
                  <select
                    id="task-priority"
                    aria-label="Priority"
                    value={taskPriority}
                    onChange={(e) => setTaskPriority(e.target.value as TaskPriority)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs font-semibold text-slate-900 focus:outline-hidden"
                  >
                    <option value="Low">Low</option>
                    <option value="Medium">Medium</option>
                    <option value="High">High</option>
                    <option value="Critical">Critical</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="task-status" className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Status
                  </label>
                  <select
                    id="task-status"
                    aria-label="Status"
                    value={taskStatus === 'In Progress' ? 'Working' : taskStatus === 'In Review' ? 'Submitted' : taskStatus}
                    onChange={(e) => setTaskStatus(e.target.value as any)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs font-semibold text-slate-900 focus:outline-hidden"
                  >
                    <option value="Not Started">Not Started</option>
                    <option value="Working">Working</option>
                    <option value="Submitted">Submitted</option>
                    <option value="Done">Done</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="task-est-hours" className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Est. Hours
                  </label>
                  <input
                    id="task-est-hours"
                    type="number"
                    step="0.5"
                    min="0.5"
                    max="100"
                    value={taskEstHours}
                    onChange={(e) => setTaskEstHours(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs font-semibold text-slate-900 focus:outline-hidden"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="task-desc" className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Description
                </label>
                <textarea
                  id="task-desc"
                  maxLength={5000}
                  rows={2}
                  placeholder="Acceptance criteria, notes, or branch names..."
                  value={taskDesc}
                  onChange={(e) => setTaskDesc(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-xs text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Subtasks builder */}
              <div className="border-t border-slate-100 pt-3">
                <label htmlFor="task-new-subtask-title" className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
                  Subtasks Checklist
                </label>
                <div className="space-y-2 mb-2 max-h-36 overflow-y-auto">
                  {subtasksList.map((st, idx) => (
                    <div key={idx} className="flex items-center justify-between gap-2 bg-slate-50 p-2 rounded-lg text-xs">
                      <span className="font-semibold text-slate-800 truncate">{st.title}</span>
                      <button
                        type="button"
                        onClick={() => setSubtasksList(prev => prev.filter((_, i) => i !== idx))}
                        className="text-slate-400 hover:text-rose-600 cursor-pointer"
                        aria-label={`Remove subtask ${st.title}`}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>

                <div className="flex items-center gap-2">
                  <input
                    id="task-new-subtask-title"
                    type="text"
                    aria-label="Add a subtask step"
                    placeholder="Add a step (e.g. Write unit tests)..."
                    value={newSubtaskTitle}
                    onChange={(e) => setNewSubtaskTitle(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddSubtaskDraft(); } }}
                    className="flex-1 px-3 py-1.5 border border-slate-300 rounded-xl text-xs"
                  />
                  <button
                    type="button"
                    onClick={handleAddSubtaskDraft}
                    className="px-3 py-1.5 text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl cursor-pointer"
                  >
                    Add
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsTaskModalOpen(false)}
                  className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingTask}
                  className="px-4 py-2 text-xs font-bold bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl shadow-xs transition-colors cursor-pointer"
                >
                  {isSavingTask ? 'Saving...' : 'Save Task'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
