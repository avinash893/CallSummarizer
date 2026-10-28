import React from 'react';

export default function ArchitectureModal({ isOpen, onClose }) {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title-row">
          <h3>Services Architecture & Status</h3>
          <button type="button" className="modal-close" onClick={onClose}>
            <i className="bi bi-x-lg"></i>
          </button>
        </div>

        <div className="service-list">
          <div className="service-card">
            <span className="service-card-title">
              <i className="bi bi-display" style={{ marginRight: '6px', color: '#1a73e8' }}></i>
              React Client
            </span>
            <span className="service-card-port">Port 5173 • Live</span>
          </div>

          <div className="service-card">
            <span className="service-card-title">
              <i className="bi bi-router" style={{ marginRight: '6px', color: '#1a73e8' }}></i>
              API Gateway
            </span>
            <span className="service-card-port">Port 5000 • Routing</span>
          </div>

          <div className="service-card">
            <span className="service-card-title">
              <i className="bi bi-broadcast-pin" style={{ marginRight: '6px', color: '#1a73e8' }}></i>
              Signaling Service
            </span>
            <span className="service-card-port">Port 5002 • WebSockets</span>
          </div>

          <div className="service-card">
            <span className="service-card-title">
              <i className="bi bi-cpu" style={{ marginRight: '6px', color: '#1a73e8' }}></i>
              NLP Task Service
            </span>
            <span className="service-card-port">Port 5003 • NLP / STT</span>
          </div>

          <div className="service-card">
            <span className="service-card-title">
              <i className="bi bi-calendar-event" style={{ marginRight: '6px', color: '#1a73e8' }}></i>
              Meeting Service
            </span>
            <span className="service-card-port">Port 5001 • REST API</span>
          </div>

          <div className="service-card">
            <span className="service-card-title">
              <i className="bi bi-database" style={{ marginRight: '6px', color: '#1a73e8' }}></i>
              MongoDB Database
            </span>
            <span className="service-card-port">Port 27017 • Persistence</span>
          </div>
        </div>

        <p style={{ fontSize: '0.78rem', color: '#6c7580', lineHeight: '1.4' }}>
          Configured in <code>docker-compose.yml</code>. Each service operates independently with isolated API boundaries.
        </p>
      </div>
    </div>
  );
}
