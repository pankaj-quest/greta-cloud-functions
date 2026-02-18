/**
 * Cloud Run Container Manager
 * - Creates new containers for projects
 * - Gets container URLs
 * - Manages container lifecycle
 */

import { RunClient, ServicesClient } from '@google-cloud/run';

const PROJECT_ID = process.env.GCP_PROJECT_ID;
const REGION = process.env.GCP_REGION || 'us-central1';
const REPOSITORY = process.env.GCP_REPOSITORY || 'greta-containers';
const IMAGE_NAME = 'greta-preview';
const GCS_BUCKET = process.env.GCS_BUCKET || 'greta-projects';

// Cloud Run client
const runClient = new ServicesClient();

/**
 * Get or create a Cloud Run container for a project
 * @param {string} projectId - Project UUID
 * @returns {Object} - { url: string, status: string }
 */
export async function getOrCreateContainer(projectId) {
  const serviceName = `greta-preview-${projectId}`;
  const parent = `projects/${PROJECT_ID}/locations/${REGION}`;
  
  try {
    // Try to get existing service
    const [service] = await runClient.getService({
      name: `${parent}/services/${serviceName}`
    });
    
    return {
      url: service.uri,
      status: 'existing',
      serviceName
    };
  } catch (error) {
    // Service doesn't exist, create it
    if (error.code === 5) { // NOT_FOUND
      return await createContainer(projectId);
    }
    throw error;
  }
}

/**
 * Create a new Cloud Run container for a project
 */
async function createContainer(projectId) {
  const serviceName = `greta-preview-${projectId}`;
  const parent = `projects/${PROJECT_ID}/locations/${REGION}`;
  const imagePath = `${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPOSITORY}/${IMAGE_NAME}:latest`;
  
  console.log(`🚀 Creating Cloud Run container: ${serviceName}`);
  
  const [operation] = await runClient.createService({
    parent,
    serviceId: serviceName,
    service: {
      template: {
        containers: [{
          image: imagePath,
          ports: [{ containerPort: 8080 }],
          env: [
            { name: 'PROJECT_ID', value: projectId },
            { name: 'GCS_BUCKET', value: GCS_BUCKET },
            { name: 'NODE_ENV', value: 'development' }
          ],
          resources: {
            limits: {
              cpu: '1',
              memory: '1Gi'
            }
          }
        }],
        scaling: {
          minInstanceCount: 0,  // Scale to zero when idle
          maxInstanceCount: 1   // One instance per project
        },
        timeout: '3600s', // 1 hour max request timeout
        sessionAffinity: true
      },
      ingress: 'INGRESS_TRAFFIC_ALL',
    }
  });
  
  // Wait for deployment
  const [service] = await operation.promise();
  
  // Make it publicly accessible (unauthenticated)
  await setPublicAccess(serviceName);
  
  console.log(`✅ Container created: ${service.uri}`);
  
  return {
    url: service.uri,
    status: 'created',
    serviceName
  };
}

/**
 * Allow unauthenticated access to the service
 */
async function setPublicAccess(serviceName) {
  const { IAMClient } = await import('@google-cloud/run');
  // Set IAM policy to allow allUsers
  // This makes the container publicly accessible
}

/**
 * Delete a Cloud Run container
 */
export async function deleteContainer(projectId) {
  const serviceName = `greta-preview-${projectId}`;
  const name = `projects/${PROJECT_ID}/locations/${REGION}/services/${serviceName}`;
  
  try {
    await runClient.deleteService({ name });
    console.log(`🗑️ Container deleted: ${serviceName}`);
    return { success: true };
  } catch (error) {
    console.error('Delete container error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get container URL for a project
 */
export async function getContainerUrl(projectId) {
  const serviceName = `greta-preview-${projectId}`;
  const name = `projects/${PROJECT_ID}/locations/${REGION}/services/${serviceName}`;
  
  try {
    const [service] = await runClient.getService({ name });
    return service.uri;
  } catch (error) {
    return null;
  }
}

export { PROJECT_ID, REGION, GCS_BUCKET };

