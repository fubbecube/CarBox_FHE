pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract CarBoxFHE is ZamaEthereumConfig {
    struct VehicleData {
        string vehicleId;
        euint32 encryptedOdometer;
        uint256 publicSpeed;
        uint256 publicFuel;
        string driverId;
        address owner;
        uint256 timestamp;
        uint32 decryptedOdometer;
        bool isDecrypted;
    }

    mapping(string => VehicleData) public vehicleRecords;
    string[] public vehicleIds;

    event VehicleDataCreated(string indexed vehicleId, address indexed owner);
    event DataDecrypted(string indexed vehicleId, uint32 decryptedOdometer);

    constructor() ZamaEthereumConfig() {
    }

    function createVehicleRecord(
        string calldata vehicleId,
        string calldata driverId,
        externalEuint32 encryptedOdometer,
        bytes calldata inputProof,
        uint256 publicSpeed,
        uint256 publicFuel
    ) external {
        require(bytes(vehicleRecords[vehicleId].vehicleId).length == 0, "Vehicle record exists");
        require(FHE.isInitialized(FHE.fromExternal(encryptedOdometer, inputProof)), "Invalid encrypted input");

        vehicleRecords[vehicleId] = VehicleData({
            vehicleId: vehicleId,
            encryptedOdometer: FHE.fromExternal(encryptedOdometer, inputProof),
            publicSpeed: publicSpeed,
            publicFuel: publicFuel,
            driverId: driverId,
            owner: msg.sender,
            timestamp: block.timestamp,
            decryptedOdometer: 0,
            isDecrypted: false
        });

        FHE.allowThis(vehicleRecords[vehicleId].encryptedOdometer);
        FHE.makePubliclyDecryptable(vehicleRecords[vehicleId].encryptedOdometer);
        vehicleIds.push(vehicleId);

        emit VehicleDataCreated(vehicleId, msg.sender);
    }

    function decryptOdometer(
        string calldata vehicleId,
        bytes memory abiEncodedClearValue,
        bytes memory decryptionProof
    ) external {
        require(bytes(vehicleRecords[vehicleId].vehicleId).length > 0, "Vehicle record not found");
        require(!vehicleRecords[vehicleId].isDecrypted, "Data already decrypted");

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(vehicleRecords[vehicleId].encryptedOdometer);

        FHE.checkSignatures(cts, abiEncodedClearValue, decryptionProof);
        uint32 decodedValue = abi.decode(abiEncodedClearValue, (uint32));

        vehicleRecords[vehicleId].decryptedOdometer = decodedValue;
        vehicleRecords[vehicleId].isDecrypted = true;

        emit DataDecrypted(vehicleId, decodedValue);
    }

    function getEncryptedOdometer(string calldata vehicleId) external view returns (euint32) {
        require(bytes(vehicleRecords[vehicleId].vehicleId).length > 0, "Vehicle record not found");
        return vehicleRecords[vehicleId].encryptedOdometer;
    }

    function getVehicleRecord(string calldata vehicleId) external view returns (
        string memory vehicleId_,
        uint256 publicSpeed,
        uint256 publicFuel,
        string memory driverId,
        address owner,
        uint256 timestamp,
        bool isDecrypted,
        uint32 decryptedOdometer
    ) {
        require(bytes(vehicleRecords[vehicleId].vehicleId).length > 0, "Vehicle record not found");
        VehicleData storage data = vehicleRecords[vehicleId];

        return (
            data.vehicleId,
            data.publicSpeed,
            data.publicFuel,
            data.driverId,
            data.owner,
            data.timestamp,
            data.isDecrypted,
            data.decryptedOdometer
        );
    }

    function getAllVehicleIds() external view returns (string[] memory) {
        return vehicleIds;
    }

    function serviceStatus() public pure returns (bool operational) {
        operational = true;
    }
}

