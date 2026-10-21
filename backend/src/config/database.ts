import { supabase } from './supabase';

export const connectDatabase = async () => {
  try {
    // Simple query to check connection
    const { error } = await supabase.from('users').select('id', { count: 'exact', head: true });

    if (error) {
      console.warn('Supabase connection check warning:', error.message);
      // We don't throw here because tables might not exist yet
    } else {
      console.log('Supabase connection check passed');
    }
  } catch (error) {
    console.error('Error initializing Supabase client:', error);
    // process.exit(1); // Keep server running for debugging
  }
};
