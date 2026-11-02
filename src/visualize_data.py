
import pandas as pd
import matplotlib.pyplot as plt

# Load dataset
df = pd.read_csv("data/deployments.csv")

# Count successful and failed deployments
status_counts = df["status"].value_counts()

# Create first chart
plt.figure(figsize=(7, 5))

status_counts.plot(
    kind="bar",
    title="Deployment Status Analysis"
)

plt.xlabel("Deployment Status")
plt.ylabel("Number of Deployments")
plt.xticks(rotation=0)

plt.tight_layout()
plt.show()


# Create second chart
plt.figure(figsize=(7, 5))

plt.bar(
    df["project"],
    df["duration_minutes"]
)

plt.title("Deployment Duration by Record")
plt.xlabel("Project")
plt.ylabel("Duration (Minutes)")

plt.tight_layout()
plt.show()
