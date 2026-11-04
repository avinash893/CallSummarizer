import React, { useEffect, useRef } from 'react';

export default function ArchitectureModal({ isOpen, onClose }) {
  const dialogRef = useRef(null);
  const previouslyFocusedElementRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;

    // Save triggering element before modal takes focus
    previouslyFocusedElementRef.current = document.activeElement;

    const focusableSelector = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

    // Move initial focus to first focusable element inside modal
    const focusTimer = setTimeout(() => {
      if (dialogRef.current) {
        const firstFocusable = dialogRef.current.querySelector(focusableSelector);
        if (firstFocusable && typeof firstFocusable.focus === 'function') {
          firstFocusable.focus();
        } else if (typeof dialogRef.current.focus === 'function') {
          dialogRef.current.focus();
        }
      }
    }, 0);

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (onClose) onClose();
        return;
      }

      if (e.key === 'Tab' && dialogRef.current) {
        const focusables = Array.from(dialogRef.current.querySelectorAll(focusableSelector)).filter(
          (el) => !el.hasAttribute('disabled')
        );

        if (focusables.length === 0) {
          e.preventDefault();
          return;
        }

        const first = focusables[0];
        const last = focusables[focusables.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === first || !dialogRef.current.contains(document.activeElement)) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last || !dialogRef.current.contains(document.activeElement)) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      clearTimeout(focusTimer);
      window.removeEventListener('keydown', handleKeyDown);
      if (previouslyFocusedElementRef.current && typeof previouslyFocusedElementRef.current.focus === 'function') {
        previouslyFocusedElementRef.current.focus();
      }
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        ref={dialogRef}
        className="modal-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="architecture-modal-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-title-row">
          <h3 id="architecture-modal-title">
            <i className="bi bi-diagram-3" style={{ marginRight: '8px' }}></i>
            Services Architecture & Status
          </h3>
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm modal-close"
            onClick={onClose}
            title="Close modal"
            aria-label="Close modal"
          >
            <i className="bi bi-x-lg"></i>
          </button>
        </div>

        <div className="service-list list-group">
          <div className="service-card list-group-item">
            <span className="service-card-title">
              <i className="bi bi-display" style={{ marginRight: '6px' }}></i>
              React Client
            </span>
            <span className="service-card-port">Cloud Web App • Live</span>
          </div>

          <div className="service-card list-group-item">
            <span className="service-card-title">
              <i className="bi bi-router" style={{ marginRight: '6px' }}></i>
              API Gateway
            </span>
            <span className="service-card-port">Render Cloud • Active</span>
          </div>

          <div className="service-card list-group-item">
            <span className="service-card-title">
              <i className="bi bi-broadcast-pin" style={{ marginRight: '6px' }}></i>
              Signaling Service
            </span>
            <span className="service-card-port">Cloud WebSockets • Active</span>
          </div>

          <div className="service-card list-group-item">
            <span className="service-card-title">
              <i className="bi bi-cpu" style={{ marginRight: '6px' }}></i>
              NLP Task Service
            </span>
            <span className="service-card-port">Gemini Cloud API • Active</span>
          </div>

          <div className="service-card list-group-item">
            <span className="service-card-title">
              <i className="bi bi-calendar-event" style={{ marginRight: '6px' }}></i>
              Meeting Service
            </span>
            <span className="service-card-port">REST API • Active</span>
          </div>

          <div className="service-card list-group-item">
            <span className="service-card-title">
              <i className="bi bi-database" style={{ marginRight: '6px' }}></i>
              MongoDB Database
            </span>
            <span className="service-card-port">Cloud Store • Active</span>
          </div>
        </div>

        <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: '1.4', margin: 0 }}>
          Deployed in cloud on Render. AI NLP and Speech-to-Text powered globally by Google Gemini API.
        </p>
      </div>
    </div>
  );
}
