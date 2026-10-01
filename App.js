import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';
import  File  from './components/file';
export default function App() {
  return (
    <View style={styles.container}>
      <Text>Sellon it</Text>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0ccc0c',
    alignItems: 'center',
    justifyContent: 'center',
    
  },
});
