import { Tabs } from 'expo-router';
import { Text } from 'react-native';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: '#FFFFFF',
          borderTopColor: '#EBEBEB',
          borderTopWidth: 1,
          height: 52,
          paddingBottom: 6,
          paddingTop: 6,
        },
        tabBarActiveTintColor: '#D97757',
        tabBarInactiveTintColor: '#999',
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '500',
        },
      }}
    >
      <Tabs.Screen
        name="chat"
        options={{
          title: 'Chat',
          tabBarIcon: ({ color }) => <Text style={{ fontSize: 18, color }}>💬</Text>,
        }}
      />
      <Tabs.Screen
        name="memory"
        options={{
          title: 'Memory',
          tabBarIcon: ({ color }) => <Text style={{ fontSize: 18, color }}>🧠</Text>,
        }}
      />
      <Tabs.Screen
        name="mcps"
        options={{
          title: 'MCPs',
          tabBarIcon: ({ color }) => <Text style={{ fontSize: 18, color }}>🔌</Text>,
        }}
      />
      <Tabs.Screen
        name="model"
        options={{
          title: 'Model',
          tabBarIcon: ({ color }) => <Text style={{ fontSize: 18, color }}>🤖</Text>,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color }) => <Text style={{ fontSize: 18, color }}>⚙️</Text>,
        }}
      />
    </Tabs>
  );
}
