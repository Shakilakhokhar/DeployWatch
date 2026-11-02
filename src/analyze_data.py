
import pandas as pd

# Load dataset
df = pd.read_csv("data/deployments.csv")

# Calculate deployment statistics
total = len(df)

successful = (df["status"] == "Success").sum()

failed = (df["status"] == "Failed").sum()

success_rate = (successful / total) * 100

average_duration = df["duration_minutes"].mean()

# Display results
print("DEPLOYMENT PERFORMANCE REPORT")

print("------------------------------")

print("Total Deployments:", total)

print("Successful Deployments:", successful)

print("Failed Deployments:", failed)

print("Success Rate:", round(success_rate, 2), "%")

print("Average Duration:", round(average_duration, 2), "minutes")
