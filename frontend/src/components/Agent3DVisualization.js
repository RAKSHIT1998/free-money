import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Stars } from '@react-three/drei';
import * as THREE from 'three';

const Agent3DVisualization = () => {
  const [agents, setAgents] = useState([]);
  const [connections, setConnections] = useState([]);
  const containerRef = useRef(null);

  // Generate agent data once and memoize
  const initializeAgentData = useCallback(() => {
    // Generate sample agent data representing different types of money-making agents
    const agentTypes = [
      { type: 'cryptoHunter', color: '#3498db', icon: '₿' },
      { type: 'opportunityScout', color: '#2ecc71', icon: '🔍' },
      { type: 'developer', color: '#f39c12', icon: '💻' },
      { type: 'manager', color: '#e74c3c', icon: '👔' }
    ];

    const generatedAgents = [];
    const generatedConnections = [];

    // Create agents in a circular arrangement
    const agentCount = 12;
    const radius = 5;

    for (let i = 0; i < agentCount; i++) {
      const angle = (i / agentCount) * Math.PI * 2;
      const agentType = agentTypes[i % agentTypes.length];

      // Reuse vector objects to reduce allocation
      const position = new THREE.Vector3(
        Math.cos(angle) * radius,
        Math.sin(angle) * radius * 0.5, // Flatten the circle slightly
        Math.sin(angle) * radius * 0.3
      );

      const agent = {
        id: i,
        type: agentType.type,
        name: `${agentType.type} ${i + 1}`,
        position,
        color: agentType.color,
        icon: agentType.icon,
        activity: 0.3 + Math.random() * 0.7, // Activity between 0.3 and 1.0
        earnings: Math.random() * 1000, // Random earnings
        lastActive: Date.now() - Math.random() * 3600000 // Last active within last hour
      };

      generatedAgents.push(agent);
    }

    // Create connections between nearby agents
    for (let i = 0; i < generatedAgents.length; i++) {
      for (let j = i + 1; j < generatedAgents.length; j++) {
        const agent1 = generatedAgents[i];
        const agent2 = generatedAgents[j];

        // Calculate distance using vector operations
        const distance = agent1.position.distanceTo(agent2.position);

        // Connect if close enough (with some randomness)
        if (distance < 4 && Math.random() > 0.3) {
          generatedConnections.push({
            start: agent1,
            end: agent2,
            strength: 0.2 + Math.random() * 0.3, // Connection strength
            lastInteraction: Date.now() - Math.random() * 1800000 // Last interaction within 30 mins
          });
        }
      }
    }

    setAgents(generatedAgents);
    setConnections(generatedConnections);
  }, []);

  useEffect(() => {
    initializeAgentData();
  }, [initializeAgentData]);

  // Memoized agent nodes to prevent unnecessary recreations
  const agentNodes = useMemo(() => {
    return agents.map(agent => ({
      key: agent.id,
      position: [agent.position.x, agent.position.y, agent.position.z],
      color: agent.color,
      size: 0.15 + agent.earnings / 5000, // Size based on earnings
      pulse: agent.activity,
      label: agent.icon
    }));
  }, [agents]);

  // Memoized connection lines
  const connectionLines = useMemo(() => {
    return connections.map((conn, index) => ({
      key: `conn-${index}`,
      startPos: [conn.start.position.x, conn.start.position.y, conn.start.position.z],
      endPos: [conn.end.position.x, conn.end.position.y, conn.end.position.z],
      color: new THREE.Color(Math.random() * 0xffffff),
      opacity: conn.strength,
      pulse: 0.5 + Math.sin(Date.now() * 0.001 + index) * 0.5 // Pulsing effect
    }));
  }, [connections]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '500px' }} ref={containerRef}>
      <div style={{
        position: 'absolute',
        top: 10,
        left: 10,
        background: 'rgba(0, 0, 0, 0.7)',
        color: 'white',
        padding: '10px',
        borderRadius: '5px',
        fontFamily: 'Arial, sans-serif',
        zIndex: 10
      }}>
        <h3>3D Financial Agent Network</h3>
        <p>Visualizing agent interactions and activities</p>
        <p>Node size = Earnings | Pulse rate = Activity level</p>
      </div>

      <Canvas
        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
        camera={{ position: [0, 5, 10], fov: 60 }}
        gl={{ antialias: true }}
      >
        {/* Lights */}
        <ambientLight intensity={0.3} />
        <directionalLight position={[5, 5, 5]} intensity={0.5} />
        <pointLight position={[-5, -5, 5]} intensity={0.3} />

        {/* Background */}
        <background>
          <mesh>
            <sphereBufferGeometry args={[50, 32, 32]} />
            <meshStandardMaterial color={0x000000} />
          </mesh>
        </background>

        {/* Stars in background */}
        <stars radius={100} count={3000} />

        {/* Agent nodes - optimized with memoization */}
        {agentNodes.map(agent => (
          <AgentNode
            key={agent.key}
            position={agent.position}
            color={agent.color}
            size={agent.size}
            pulse={agent.pulse}
            label={agent.label}
          />
        ))}

        {/* Connection lines - optimized with memoization */}
        {connectionLines.map(conn => (
          <Connection
            key={conn.key}
            startPos={conn.startPos}
            endPos={conn.endPos}
            color={conn.color}
            opacity={conn.opacity}
            pulse={conn.pulse}
          />
        ))}

        {/* Floor grid */}
        <mesh rotation={[- Math.PI / 2, 0, 0]}>
          <planeGeometry args={[20, 20]} />
          <meshStandardMaterial
            color={0x202020}
            opacity={0.2}
            transparent
          />
        </mesh>

        {/* Controls */}
        <OrbitControls
          enableZoom
          enablePan
          enableRotate
          maxDistance={20}
          minDistance={5}
        />
      </Canvas>
    </div>
  );
};

// Optimized AgentNode component with React.memo
const AgentNode = React.memo(({ position, color, size, pulse }) => {
  const pulseRef = React.useRef(0);

  React.useEffect(() => {
    const pulseInterval = setInterval(() => {
      pulseRef.current = (pulseRef.current + 0.05) % (Math.PI * 2);
    }, 50);

    return () => clearInterval(pulseInterval);
  }, []);

  const pulseScale = 1 + Math.sin(pulseRef.current) * 0.2 * pulse;

  return (
    <group position={position} scale={[size * pulseScale, size * pulseScale, size * pulseScale]}>
      <mesh>
        <sphereGeometry args={[1, 16, 16]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.3}
        />
      </mesh>

      {/* Label */}
      <group position={[0, 1.2, 0]} scale={[0.008, 0.008, 0.008]}>
        <text
          fontSize={1}
          color="white"
        >
          {label}
        </text>
      </group>
    </group>
  );
});

// Optimized Connection component with React.memo
const Connection = React.memo(({ startPos, endPos, color, opacity, pulse }) => {
  const [start] = React.useState(new THREE.Vector3());
  const [end] = React.useState(new THREE.Vector3());
  const [cloned] = React.useState(new THREE.Vector3());

  React.useEffect(() => {
    start.set(...startPos);
    end.set(...endPos);
  }, [startPos, endPos]);

  React.useEffect(() => {
    // Calculate middle point for curve
    cloned.copy(start).lerp(end, 0.5);
    const perpendicular = new THREE.Vector3(
      -(end.y - start.y),
      (end.x - start.x),
      0
    ).normalize().multiplyScalar(1); // Height of arc
    cloned.add(perpendicular);
  }, [start, end]);

  const points = [start, cloned, end];
  const geometry = new THREE.BufferGeometry().setFromPoints(points);

  return (
    <line>
      <bufferGeometry
        attributes={{ position: new THREE.Float32BufferAttribute(geometry.attributes.position.array, 3) }}
      />
      <lineDashedMaterial
        color={color}
        linewidth={2}
        dashSize={0.2}
        gapSize={0.1}
        transparent
        opacity={opacity * (0.7 + pulse * 0.3)}
      />
    </line>
  );
});

export default Agent3DVisualization;