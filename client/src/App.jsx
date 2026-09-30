import React, { useState, useEffect } from 'react';
import { jsPDF } from 'jspdf';
import TopBar from './components/TopBar';
import VideoCanvas from './components/VideoCanvas';
import ControlDock from './components/ControlDock';
import NotesDrawer from './components/NotesDrawer';
import Lobby from './components/Lobby';
import ArchitectureModal from './components/ArchitectureModal';

export default function App() {
  const [isInCall, setIsInCall] = useState(false);
  const [roomName, setRoomName] = useState('strategy-sync');
  const [isVideoOn, setIsVideoOn] = useState(true);
  const [isAudioOn, setIsAudioOn] = useState(true);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isNotesOpen, setIsNotesOpen] = useState(true);
  const [isArchModalOpen, setIsArchModalOpen] = useState(false);
  const [localStream, setLocalStream] = useState(null);
  const [callSeconds, setCallSeconds] = useState(0);

  // Clean task items with Indian name
  const [tasks, setTasks] = useState([
    { id: 1, title: 'Review microservice signaling service', assignee: 'Rohan', due: 'Tomorrow', completed: false },
    { id: 2, title: 'Check video layout on different screen sizes', assignee: 'You', due: 'Today', completed: true },
    { id: 3, title: 'Connect speech-to-text recording endpoint', assignee: 'You', due: 'Friday', completed: false }
  ]);

  // Camera preview hook
  useEffect(() => {
    async function initCamera() {
      try {
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
          const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
          setLocalStream(stream);
        }
      } catch (err) {
        // Fallback to standby avatar
      }
    }
    initCamera();

    return () => {
      if (localStream) {
        localStream.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  // Call timer
  useEffect(() => {
    let interval = null;
    if (isInCall) {
      interval = setInterval(() => {
        setCallSeconds((sec) => sec + 1);
      }, 1000);
    } else {
      setCallSeconds(0);
    }
    return () => clearInterval(interval);
  }, [isInCall]);

  const formatTimer = (totalSeconds) => {
    const mins = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
    const secs = (totalSeconds % 60).toString().padStart(2, '0');
    return `${mins}:${secs}`;
  };

  const handleJoinCall = () => {
    setIsInCall(true);
  };

  const handleLeaveCall = () => {
    setIsInCall(false);
    setIsScreenSharing(false);
  };

  const toggleVideo = () => {
    const nextState = !isVideoOn;
    setIsVideoOn(nextState);
    if (localStream) {
      const track = localStream.getVideoTracks()[0];
      if (track) track.enabled = nextState;
    }
  };

  const toggleAudio = () => {
    const nextState = !isAudioOn;
    setIsAudioOn(nextState);
    if (localStream) {
      const track = localStream.getAudioTracks()[0];
      if (track) track.enabled = nextState;
    }
  };

  const toggleScreenShare = () => {
    setIsScreenSharing(!isScreenSharing);
  };

  const handleToggleTask = (id) => {
    setTasks((prev) =>
      prev.map((task) =>
        task.id === id ? { ...task, completed: !task.completed } : task
      )
    );
  };

  const handleCopyRoom = () => {
    navigator.clipboard?.writeText(window.location.href);
    alert('Meeting link copied to clipboard.');
  };

  // Real PDF Generator using jsPDF
  const handleExportPdf = () => {
    try {
      const doc = new jsPDF();

      // Brand Header
      doc.setFontSize(22);
      doc.setTextColor(26, 115, 232); // #1a73e8
      doc.text('CallSummarizer', 20, 22);

      doc.setFontSize(13);
      doc.setTextColor(80, 80, 80);
      doc.text('Meeting Summary & Action Items', 20, 30);

      // Top Divider
      doc.setDrawColor(210, 215, 225);
      doc.line(20, 34, 190, 34);

      // Metadata Block
      doc.setFontSize(10);
      doc.setTextColor(90, 95, 105);
      doc.text(`Meeting Room: ${roomName || 'Session'}`, 20, 42);
      doc.text(`Date: ${new Date().toLocaleDateString('en-IN', { dateStyle: 'long' })}`, 20, 48);
      doc.text(`Call Duration: ${formatTimer(callSeconds)}`, 120, 42);
      doc.text(`Participants: You (Host), Rohan Sharma`, 120, 48);

      // Section 1: Executive Summary
      doc.setFontSize(14);
      doc.setTextColor(26, 115, 232);
      doc.text('1. Discussion Summary', 20, 60);

      doc.setFontSize(10);
      doc.setTextColor(50, 50, 50);
      const summaryItems = [
        '• Reviewed project architecture and frontend migration to React.',
        '• Fixed video tile spacing to prevent layout overlap.',
        '• Verified microservice blueprints for signaling, meetings, and NLP task extraction.'
      ];

      let currentY = 68;
      summaryItems.forEach((line) => {
        doc.text(line, 24, currentY);
        currentY += 7;
      });

      // Section 2: Action Items / Tasks
      currentY += 6;
      doc.setFontSize(14);
      doc.setTextColor(26, 115, 232);
      doc.text('2. Action Items', 20, currentY);
      currentY += 8;

      doc.setFontSize(10);
      doc.setTextColor(50, 50, 50);
      tasks.forEach((task) => {
        const checkStatus = task.completed ? '[DONE]' : '[PENDING]';
        doc.text(`${checkStatus}  ${task.title}`, 24, currentY);
        doc.setFontSize(9);
        doc.setTextColor(110, 110, 110);
        doc.text(`Assignee: ${task.assignee}  |  Due: ${task.due}`, 36, currentY + 5);
        doc.setFontSize(10);
        doc.setTextColor(50, 50, 50);
        currentY += 12;
      });

      // Section 3: Live Transcript Snippet
      currentY += 4;
      doc.setFontSize(14);
      doc.setTextColor(26, 115, 232);
      doc.text('3. Transcript Excerpt', 20, currentY);
      currentY += 8;

      doc.setFontSize(9);
      doc.setTextColor(80, 80, 80);
      doc.text('[10:00 AM] You: "Welcome to the meeting. Let\'s discuss today\'s project milestones and action items."', 24, currentY);
      currentY += 6;
      doc.text('[10:01 AM] Rohan Sharma: "Sounds good, I have the architecture and task breakdown ready for review."', 24, currentY);

      // Bottom Footer
      doc.setFontSize(8);
      doc.setTextColor(150, 150, 150);
      doc.text('Generated by CallSummarizer • MERN Stack & Microservices', 20, 280);

      // Trigger automatic browser download
      const cleanFileName = `meeting-summary-${(roomName || 'call').toLowerCase().replace(/[^a-z0-9]/g, '-')}.pdf`;
      doc.save(cleanFileName);
    } catch (err) {
      console.error('PDF Generation Error:', err);
    }
  };

  return (
    <div className="app-shell">
      {!isInCall ? (
        <Lobby
          roomName={roomName}
          setRoomName={setRoomName}
          onJoinCall={handleJoinCall}
          isVideoOn={isVideoOn}
          toggleVideo={toggleVideo}
          isAudioOn={isAudioOn}
          toggleAudio={toggleAudio}
          localStream={localStream}
        />
      ) : (
        <>
          <TopBar
            roomName={roomName}
            callDuration={formatTimer(callSeconds)}
            isNotesOpen={isNotesOpen}
            setIsNotesOpen={setIsNotesOpen}
            onOpenArchModal={() => setIsArchModalOpen(true)}
            onCopyRoom={handleCopyRoom}
          />

          <main className="main-stage">
            <VideoCanvas
              isVideoOn={isVideoOn}
              isAudioOn={isAudioOn}
              localStream={localStream}
              remoteSpeaking={callSeconds % 6 > 3}
            />

            <NotesDrawer
              isOpen={isNotesOpen}
              tasks={tasks}
              onToggleTask={handleToggleTask}
              onExportPdf={handleExportPdf}
            />

            <ControlDock
              isAudioOn={isAudioOn}
              toggleAudio={toggleAudio}
              isVideoOn={isVideoOn}
              toggleVideo={toggleVideo}
              isScreenSharing={isScreenSharing}
              toggleScreenShare={toggleScreenShare}
              isNotesOpen={isNotesOpen}
              setIsNotesOpen={setIsNotesOpen}
              onLeaveCall={handleLeaveCall}
            />
          </main>
        </>
      )}

      <ArchitectureModal
        isOpen={isArchModalOpen}
        onClose={() => setIsArchModalOpen(false)}
      />
    </div>
  );
}
