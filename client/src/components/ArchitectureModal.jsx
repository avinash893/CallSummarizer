import React from 'react';

export default function ArchitectureModal({ isOpen, onClose }) {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title-row">
          <h3>
            <i className="bi bi-diagram-3" style={{ marginRight: '8px' }}></i>
            Services Architecture & Status
          </h3>
          <button type="button" className="btn btn-outline-secondary btn-sm modal-close" onClick={onClose} title="Close modal">
            <i className="bi bi-x-lg"></i>
          </button>
        </div>

        <div className="service-list list-group">
          <div className="service-card list-group-item">
            <span className="service-card-title">
              <i className="bi bi-display" style={{ marginRight: '6px' }}></i>
              React Client
            </span>
            <span className="service-card-port">Port 5173 • Live</span>
          </div>

          <div className="service-card list-group-item">
            <span className="service-card-title">
              <i className="bi bi-router" style={{ marginRight: '6px' }}></i>
              API Gateway
            </span>
            <span className="service-card-port">Port 5000 • Routing</span>
          </div>

          <div className="service-card list-group-item">
            <span className="service-card-title">
              <i className="bi bi-broadcast-pin" style={{ marginRight: '6px' }}></i>
              Signaling Service
            </span>
            <span className="service-card-port">Port 5002 • WebSockets</span>
          </div>

          <div className="service-card list-group-item">
            <span className="service-card-title">
              <i className="bi bi-cpu" style={{ marginRight: '6px' }}></i>
              NLP Task Service
            </span>
            <span className="service-card-port">Port 5003 • NLP / STT</span>
          </div>

          <div className="service-card list-group-item">
            <span className="service-card-title">
              <i className="bi bi-calendar-event" style={{ marginRight: '6px' }}></i>
              Meeting Service
            </span>
            <span className="service-card-port">Port 5001 • REST API</span>
          </div>

          <div className="service-card list-group-item">
            <span className="service-card-title">
              <i className="bi bi-database" style={{ marginRight: '6px' }}></i>
              MongoDB Database
            </span>
            <span className="service-card-port">Port 27017 • Persistence</span>
          </div>
        </div>

        <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: '1.4', margin: 0 }}>
          Configured in <code>docker-compose.yml</code>. Each service operates independently with isolated API boundaries.
        </p>
      </div>
    </div>
  );
}
