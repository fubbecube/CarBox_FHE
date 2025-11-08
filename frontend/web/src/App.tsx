import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface VehicleData {
  id: string;
  vin: string;
  speed: number;
  mileage: number;
  fuelLevel: number;
  engineTemp: number;
  timestamp: number;
  creator: string;
  isVerified?: boolean;
  decryptedValue?: number;
  encryptedValueHandle?: string;
  accidentFlag: boolean;
  description: string;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [vehicleData, setVehicleData] = useState<VehicleData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingData, setCreatingData] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending" as const, 
    message: "" 
  });
  const [newVehicleData, setNewVehicleData] = useState({ 
    vin: "", 
    speed: "", 
    mileage: "", 
    fuelLevel: "",
    engineTemp: "",
    description: ""
  });
  const [selectedVehicle, setSelectedVehicle] = useState<VehicleData | null>(null);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [stats, setStats] = useState({
    totalRecords: 0,
    verifiedRecords: 0,
    accidentRecords: 0,
    avgSpeed: 0
  });

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected) return;
      if (isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        console.log('Initializing FHEVM for CarBox...');
        await initialize();
        console.log('FHEVM initialized successfully');
      } catch (error) {
        console.error('Failed to initialize FHEVM:', error);
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const vehicleList: VehicleData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          vehicleList.push({
            id: businessId,
            vin: businessData.name,
            speed: Number(businessData.publicValue1) || 0,
            mileage: Number(businessData.publicValue2) || 0,
            fuelLevel: 0,
            engineTemp: 0,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0,
            accidentFlag: businessData.description.includes("accident"),
            description: businessData.description
          });
        } catch (e) {
          console.error('Error loading vehicle data:', e);
        }
      }
      
      setVehicleData(vehicleList);
      updateStats(vehicleList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const updateStats = (data: VehicleData[]) => {
    const total = data.length;
    const verified = data.filter(v => v.isVerified).length;
    const accidents = data.filter(v => v.accidentFlag).length;
    const avgSpeed = data.length > 0 ? data.reduce((sum, v) => sum + v.speed, 0) / data.length : 0;
    
    setStats({ totalRecords: total, verifiedRecords: verified, accidentRecords: accidents, avgSpeed });
  };

  const createVehicleData = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingData(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Encrypting vehicle data with Zama FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const speedValue = parseInt(newVehicleData.speed) || 0;
      const businessId = `vehicle-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, speedValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newVehicleData.vin,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        parseInt(newVehicleData.mileage) || 0,
        parseInt(newVehicleData.fuelLevel) || 0,
        newVehicleData.description
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Encrypting and storing on blockchain..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Vehicle data encrypted and stored!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewVehicleData({ vin: "", speed: "", mileage: "", fuelLevel: "", engineTemp: "", description: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingData(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption proof..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Speed data decrypted successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data is already verified" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
        await loadData();
        return null;
      }
      
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Decryption failed: " + (e.message || "Unknown error") 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
  };

  const testAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      setTransactionStatus({ 
        visible: true, 
        status: "success", 
        message: `Contract is available: ${isAvailable}` 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const renderStatsDashboard = () => {
    return (
      <div className="stats-dashboard">
        <div className="stat-card titanium-card">
          <div className="stat-icon">🚗</div>
          <div className="stat-content">
            <h3>Total Records</h3>
            <div className="stat-value">{stats.totalRecords}</div>
            <div className="stat-trend">Encrypted Data Points</div>
          </div>
        </div>
        
        <div className="stat-card titanium-card">
          <div className="stat-icon">🔐</div>
          <div className="stat-content">
            <h3>Verified Data</h3>
            <div className="stat-value">{stats.verifiedRecords}</div>
            <div className="stat-trend">On-chain Verified</div>
          </div>
        </div>
        
        <div className="stat-card titanium-card">
          <div className="stat-icon">⚠️</div>
          <div className="stat-content">
            <h3>Accident Flags</h3>
            <div className="stat-value">{stats.accidentRecords}</div>
            <div className="stat-trend">Require Investigation</div>
          </div>
        </div>
        
        <div className="stat-card titanium-card">
          <div className="stat-icon">📊</div>
          <div className="stat-content">
            <h3>Avg Speed</h3>
            <div className="stat-value">{stats.avgSpeed.toFixed(1)}</div>
            <div className="stat-trend">km/h FHE Protected</div>
          </div>
        </div>
      </div>
    );
  };

  const renderFHEProcess = () => {
    return (
      <div className="fhe-process-flow">
        <div className="process-step">
          <div className="step-number">1</div>
          <div className="step-content">
            <h4>Data Collection</h4>
            <p>Vehicle sensors collect speed data in real-time</p>
          </div>
        </div>
        
        <div className="process-connector">→</div>
        
        <div className="process-step">
          <div className="step-number">2</div>
          <div className="step-content">
            <h4>FHE Encryption</h4>
            <p>Speed data encrypted using Zama FHE technology</p>
          </div>
        </div>
        
        <div className="process-connector">→</div>
        
        <div className="process-step">
          <div className="step-number">3</div>
          <div className="step-content">
            <h4>Blockchain Storage</h4>
            <p>Encrypted data stored on-chain for integrity</p>
          </div>
        </div>
        
        <div className="process-connector">→</div>
        
        <div className="process-step">
          <div className="step-number">4</div>
          <div className="step-content">
            <h4>Accident Trigger</h4>
            <p>Authorized parties can decrypt for investigation</p>
          </div>
        </div>
      </div>
    );
  };

  const renderSpeedChart = (vehicle: VehicleData, decryptedSpeed: number | null) => {
    const speed = vehicle.isVerified ? (vehicle.decryptedValue || 0) : (decryptedSpeed || vehicle.speed || 0);
    const maxSpeed = 200;
    const percentage = Math.min(100, (speed / maxSpeed) * 100);
    
    return (
      <div className="speed-chart">
        <div className="chart-header">
          <h4>Speed Analysis</h4>
          <span className="speed-value">{speed} km/h</span>
        </div>
        <div className="speed-meter">
          <div 
            className="speed-fill"
            style={{ width: `${percentage}%` }}
            data-speed={speed}
          ></div>
        </div>
        <div className="speed-labels">
          <span>0</span>
          <span>50</span>
          <span>100</span>
          <span>150</span>
          <span>200+</span>
        </div>
      </div>
    );
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header metal-header">
          <div className="logo-section">
            <div className="logo-icon">🚗🔐</div>
            <h1>CarBox FHE</h1>
            <span className="tagline">Encrypted Vehicle Blackbox</span>
          </div>
          <div className="header-actions">
            <div className="wallet-connect-wrapper">
              <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
            </div>
          </div>
        </header>
        
        <div className="connection-prompt metal-bg">
          <div className="connection-content">
            <div className="connection-icon">🔐</div>
            <h2>Connect Wallet to Access CarBox</h2>
            <p>Secure your vehicle data with fully homomorphic encryption technology</p>
            <div className="feature-grid">
              <div className="feature-item">
                <span className="feature-icon">🚗</span>
                <h4>Real-time Encryption</h4>
                <p>Vehicle data encrypted before blockchain storage</p>
              </div>
              <div className="feature-item">
                <span className="feature-icon">🔒</span>
                <h4>Privacy First</h4>
                <p>Insurance companies cannot access data without authorization</p>
              </div>
              <div className="feature-item">
                <span className="feature-icon">⚡</span>
                <h4>Accident Response</h4>
                <p>Instant data access for authorized accident investigation</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen metal-bg">
        <div className="fhe-spinner metal-spinner"></div>
        <p>Initializing FHE Encryption System...</p>
        <p className="loading-note">Securing vehicle data with Zama FHE</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen metal-bg">
      <div className="fhe-spinner metal-spinner"></div>
      <p>Loading encrypted vehicle data...</p>
    </div>
  );

  return (
    <div className="app-container metal-theme">
      <header className="app-header metal-header">
        <div className="logo-section">
          <div className="logo-icon">🚗🔐</div>
          <div>
            <h1>CarBox FHE</h1>
            <span className="tagline">Encrypted Vehicle Blackbox</span>
          </div>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={testAvailability}
            className="test-btn metal-btn"
          >
            Test Contract
          </button>
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-btn metal-btn primary"
          >
            + Add Vehicle Data
          </button>
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </div>
      </header>
      
      <main className="main-content metal-dashboard">
        <section className="dashboard-section">
          <h2>Vehicle Data Analytics Dashboard</h2>
          {renderStatsDashboard()}
          
          <div className="fhe-explainer metal-panel">
            <h3>FHE 🔐 Encryption Process</h3>
            {renderFHEProcess()}
          </div>
        </section>
        
        <section className="data-section">
          <div className="section-header">
            <h2>Encrypted Vehicle Records</h2>
            <div className="section-actions">
              <button 
                onClick={loadData} 
                className="refresh-btn metal-btn"
                disabled={isRefreshing}
              >
                {isRefreshing ? "🔄 Refreshing..." : "🔄 Refresh"}
              </button>
            </div>
          </div>
          
          <div className="data-grid">
            {vehicleData.length === 0 ? (
              <div className="no-data metal-panel">
                <div className="no-data-icon">🚗</div>
                <p>No vehicle data records found</p>
                <button 
                  className="create-btn metal-btn primary"
                  onClick={() => setShowCreateModal(true)}
                >
                  Add First Record
                </button>
              </div>
            ) : (
              vehicleData.map((vehicle, index) => (
                <div 
                  className={`data-card metal-card ${vehicle.accidentFlag ? 'accident' : ''} ${vehicle.isVerified ? 'verified' : ''}`}
                  key={index}
                  onClick={() => setSelectedVehicle(vehicle)}
                >
                  <div className="card-header">
                    <h3>{vehicle.vin}</h3>
                    {vehicle.accidentFlag && <span className="accident-badge">⚠️ Accident</span>}
                    {vehicle.isVerified && <span className="verified-badge">✅ Verified</span>}
                  </div>
                  <div className="card-content">
                    <div className="data-row">
                      <span>Speed:</span>
                      <span className={vehicle.isVerified ? 'decrypted-value' : 'encrypted-value'}>
                        {vehicle.isVerified ? `${vehicle.decryptedValue} km/h` : '🔒 Encrypted'}
                      </span>
                    </div>
                    <div className="data-row">
                      <span>Mileage:</span>
                      <span>{vehicle.mileage} km</span>
                    </div>
                    <div className="data-row">
                      <span>Date:</span>
                      <span>{new Date(vehicle.timestamp * 1000).toLocaleDateString()}</span>
                    </div>
                  </div>
                  <div className="card-footer">
                    <span className="creator">By: {vehicle.creator.substring(0, 8)}...</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </main>
      
      {showCreateModal && (
        <CreateDataModal 
          onSubmit={createVehicleData} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingData} 
          vehicleData={newVehicleData} 
          setVehicleData={setNewVehicleData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedVehicle && (
        <DetailModal 
          vehicle={selectedVehicle} 
          onClose={() => setSelectedVehicle(null)} 
          isDecrypting={fheIsDecrypting} 
          decryptData={() => decryptData(selectedVehicle.id)}
          renderSpeedChart={renderSpeedChart}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-toast">
          <div className={`toast-content ${transactionStatus.status}`}>
            <div className="toast-icon">
              {transactionStatus.status === "pending" && <div className="spinner"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✗"}
            </div>
            <div className="toast-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const CreateDataModal: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  vehicleData: any;
  setVehicleData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, vehicleData, setVehicleData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setVehicleData({ ...vehicleData, [name]: value });
  };

  return (
    <div className="modal-overlay metal-overlay">
      <div className="create-modal metal-modal">
        <div className="modal-header">
          <h2>Add Vehicle Data Record</h2>
          <button onClick={onClose} className="close-btn metal-close">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="encryption-notice metal-notice">
            <div className="notice-icon">🔐</div>
            <div>
              <strong>FHE Encryption Active</strong>
              <p>Speed data will be encrypted using Zama FHE technology</p>
            </div>
          </div>
          
          <div className="form-grid">
            <div className="form-group">
              <label>Vehicle VIN *</label>
              <input 
                type="text" 
                name="vin" 
                value={vehicleData.vin} 
                onChange={handleChange} 
                placeholder="Enter vehicle VIN..." 
                className="metal-input"
              />
            </div>
            
            <div className="form-group">
              <label>Speed (km/h) *</label>
              <input 
                type="number" 
                name="speed" 
                value={vehicleData.speed} 
                onChange={handleChange} 
                placeholder="Enter speed..."
                className="metal-input encrypted-field"
              />
              <span className="field-tag">FHE Encrypted</span>
            </div>
            
            <div className="form-group">
              <label>Mileage (km) *</label>
              <input 
                type="number" 
                name="mileage" 
                value={vehicleData.mileage} 
                onChange={handleChange} 
                placeholder="Enter mileage..."
                className="metal-input"
              />
              <span className="field-tag">Public Data</span>
            </div>
            
            <div className="form-group">
              <label>Fuel Level (%)</label>
              <input 
                type="number" 
                name="fuelLevel" 
                value={vehicleData.fuelLevel} 
                onChange={handleChange} 
                placeholder="Enter fuel level..."
                className="metal-input"
              />
            </div>
          </div>
          
          <div className="form-group full-width">
            <label>Description *</label>
            <textarea 
              name="description" 
              value={vehicleData.description} 
              onChange={handleChange} 
              placeholder="Describe driving conditions, any incidents..."
              className="metal-textarea"
              rows={3}
            />
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn metal-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !vehicleData.vin || !vehicleData.speed || !vehicleData.description} 
            className="submit-btn metal-btn primary"
          >
            {creating || isEncrypting ? "🔐 Encrypting..." : "Encrypt & Store"}
          </button>
        </div>
      </div>
    </div>
  );
};

const DetailModal: React.FC<{
  vehicle: VehicleData;
  onClose: () => void;
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
  renderSpeedChart: (vehicle: VehicleData, decryptedSpeed: number | null) => JSX.Element;
}> = ({ vehicle, onClose, isDecrypting, decryptData, renderSpeedChart }) => {
  const [decryptedSpeed, setDecryptedSpeed] = useState<number | null>(null);

  const handleDecrypt = async () => {
    if (vehicle.isVerified) return;
    
    const speed = await decryptData();
    if (speed !== null) {
      setDecryptedSpeed(speed);
    }
  };

  return (
    <div className="modal-overlay metal-overlay">
      <div className="detail-modal metal-modal">
        <div className="modal-header">
          <h2>Vehicle Data Details</h2>
          <button onClick={onClose} className="close-btn metal-close">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="vehicle-info">
            <div className="info-grid">
              <div className="info-item">
                <span>VIN:</span>
                <strong>{vehicle.vin}</strong>
              </div>
              <div className="info-item">
                <span>Creator:</span>
                <strong>{vehicle.creator.substring(0, 8)}...{vehicle.creator.substring(38)}</strong>
              </div>
              <div className="info-item">
                <span>Record Date:</span>
                <strong>{new Date(vehicle.timestamp * 1000).toLocaleString()}</strong>
              </div>
              <div className="info-item">
                <span>Mileage:</span>
                <strong>{vehicle.mileage} km</strong>
              </div>
            </div>
          </div>
          
          <div className="data-section">
            <div className="section-header">
              <h3>Speed Data Analysis</h3>
              <button 
                className={`decrypt-btn metal-btn ${vehicle.isVerified ? 'verified' : ''}`}
                onClick={handleDecrypt} 
                disabled={isDecrypting || vehicle.isVerified}
              >
                {isDecrypting ? "🔓 Decrypting..." : 
                 vehicle.isVerified ? "✅ Verified" : 
                 "🔓 Decrypt Speed"}
              </button>
            </div>
            
            {renderSpeedChart(vehicle, decryptedSpeed)}
            
            <div className="encryption-status">
              <div className="status-item">
                <span>Encryption Status:</span>
                <span className={vehicle.isVerified ? 'status-verified' : 'status-encrypted'}>
                  {vehicle.isVerified ? '✅ On-chain Verified' : '🔒 FHE Encrypted'}
                </span>
              </div>
              <div className="status-item">
                <span>Data Type:</span>
                <span>Integer (km/h)</span>
              </div>
            </div>
          </div>
          
          <div className="description-section">
            <h3>Record Description</h3>
            <div className="description-content metal-panel">
              {vehicle.description}
              {vehicle.accidentFlag && (
                <div className="accident-warning">
                  ⚠️ This record has been flagged for accident investigation
                </div>
              )}
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn metal-btn">Close</button>
          {!vehicle.isVerified && (
            <button 
              onClick={handleDecrypt} 
              disabled={isDecrypting}
              className="verify-btn metal-btn primary"
            >
              {isDecrypting ? "Verifying..." : "Verify on-chain"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;

